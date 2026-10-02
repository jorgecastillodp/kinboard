import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVICES, SERVICE_HANDLERS } from "../src/app/api/integration/v1/services/[service]/route";
import {
  DEFAULT_TAKEOVER_SECONDS,
  SHOW_CAMERA_RATE_LIMIT,
  SHOW_CAMERA_RATE_WINDOW_MS,
  activeTakeover,
  listableCameras,
  parseTakeoverDuration,
  resolveCamera,
  resolveTargetDevices,
  takeoverRemainingMs,
  type CameraTakeoverRow,
} from "../src/lib/camera-takeover";
import { screensaverAllowed } from "../src/lib/screensaver-gate";

/**
 * show_camera (#335): Home Assistant puts a camera on the wall displays for a
 * minute when the doorbell rings, and every phone gets a push that opens it.
 *
 * The rules that decide something are pure and driven here directly: how a
 * call names its camera and its screens, how long it stays, and what a given
 * screen should show at a given moment of the server's clock. The service
 * itself runs against a stand-in database seeded with what a real install
 * holds — cameras whose stream URLs carry a password, and another family --
 * so a handler that leaked a URL or crossed a family would show it here.
 */

const FAMILY = "11111111-1111-4111-8111-111111111111";
const OTHER_FAMILY = "22222222-2222-4222-8222-222222222222";
const WALL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HALL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PHONE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_WALL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Row = Record<string, unknown>;

const SEED: Record<string, Row[]> = {
  settings: [
    {
      family_id: FAMILY,
      key: "cameras",
      value: {
        cameras: [
          { id: "cam-garden", name: "Garden", stream_type: "rtsp", stream_url: "rtsp://user:secret@10.0.0.5/garden", enabled: true, position: 2 },
          { id: "cam-door", name: "Front door", stream_type: "rtsp", stream_url: "rtsp://user:secret@10.0.0.5/door", auth: { username: "u", password: "p", type: "basic" }, enabled: true, position: 1 },
          { id: "cam-old", name: "Old", stream_type: "mjpeg", stream_url: "http://10.0.0.9/old", enabled: false, position: 0 },
        ],
      },
    },
    {
      family_id: OTHER_FAMILY,
      key: "cameras",
      value: { cameras: [{ id: "cam-theirs", name: "Theirs", stream_type: "rtsp", stream_url: "rtsp://x", enabled: true, position: 0 }] },
    },
  ],
  devices: [
    { id: WALL, family_id: FAMILY, name: "Kitchen wall", is_kiosk: true },
    { id: HALL, family_id: FAMILY, name: "Hall", is_kiosk: true },
    { id: PHONE, family_id: FAMILY, name: "Phone", is_kiosk: false },
    { id: OTHER_WALL, family_id: OTHER_FAMILY, name: "Kitchen wall", is_kiosk: true },
  ],
};

/** Applies the filters it is given, records every write, and is awaitable like the real query builder. */
function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const writes: Array<{ table: string; op: "insert" | "upsert"; row: Row; options?: unknown }> = [];
  function from(table: string) {
    const preds: Array<(row: Row) => boolean> = [];
    const rows = () => (tables[table] ?? []).filter((row) => preds.every((p) => p(row)));
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => (preds.push((r) => r[column] === value), chain),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      upsert: async (row: Row, options?: unknown) => (writes.push({ table, op: "upsert", row, options }), { error: null }),
      insert: async (row: Row) => (writes.push({ table, op: "insert", row }), { error: null }),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
    };
    return chain;
  }
  return { db: { from }, writes };
}

async function call(body: Row, seed = SEED) {
  const { db, writes } = fakeDb(seed);
  const result = await SERVICE_HANDLERS.show_camera({ familyId: FAMILY, body, assistant: false, db });
  return { ...result, writes };
}

test.describe("show_camera: the rules", () => {
  test("duration is a minute unless the call says otherwise, and stays in range", () => {
    expect(parseTakeoverDuration(undefined)).toEqual({ ok: true, seconds: DEFAULT_TAKEOVER_SECONDS });
    expect(DEFAULT_TAKEOVER_SECONDS).toBe(60);
    expect(parseTakeoverDuration(90)).toEqual({ ok: true, seconds: 90 });
    // What a Home Assistant template renders a number as.
    expect(parseTakeoverDuration("120")).toEqual({ ok: true, seconds: 120 });
    for (const bad of [4, 301, 30.5, -1, "1m", true, {}]) {
      expect(parseTakeoverDuration(bad).ok, String(bad)).toBe(false);
    }
  });

  test("a camera is named by its id or its exact name, never a guess", () => {
    const cameras = [
      { id: "cam-door", name: "Front door" },
      { id: "cam-garden", name: "Garden" },
      { id: "cam-2", name: "Garden" },
      { id: "Front door", name: "Porch" },
    ];
    expect(resolveCamera(cameras, "cam-door")).toEqual({ ok: true, camera: cameras[0] });
    // An id wins over another camera's name.
    expect(resolveCamera(cameras, "Front door")).toEqual({ ok: true, camera: cameras[3] });
    expect(resolveCamera(cameras.slice(0, 2), "Front door")).toEqual({ ok: true, camera: cameras[0] });
    expect(resolveCamera(cameras, "  cam-door ")).toEqual({ ok: true, camera: cameras[0] });

    const ambiguous = resolveCamera(cameras, "Garden");
    expect(ambiguous.ok).toBe(false);
    expect(!ambiguous.ok && ambiguous.error).toContain("use the id");
    for (const miss of ["front door", "Front doo", "", "   ", undefined, 3]) {
      expect(resolveCamera(cameras.slice(0, 2), miss).ok, String(miss)).toBe(false);
    }
  });

  test("the screens are the kiosk devices unless the call names others", () => {
    const devices = [
      { id: WALL, name: "Kitchen wall", is_kiosk: true },
      { id: HALL, name: "Hall", is_kiosk: true },
      { id: PHONE, name: "Phone", is_kiosk: false },
      { id: "e", name: "Twin", is_kiosk: false },
      { id: "f", name: "Twin", is_kiosk: null },
    ];
    expect(resolveTargetDevices(devices, undefined)).toEqual({ ok: true, deviceIds: [WALL, HALL] });
    expect(resolveTargetDevices(devices, [PHONE, "Hall"])).toEqual({ ok: true, deviceIds: [PHONE, HALL] });
    expect(resolveTargetDevices(devices, "Kitchen wall")).toEqual({ ok: true, deviceIds: [WALL] });
    expect(resolveTargetDevices(devices, ["Hall", HALL])).toEqual({ ok: true, deviceIds: [HALL] });

    const unknown = resolveTargetDevices(devices, ["Hall", "Garage", "Attic"]);
    expect(!unknown.ok && unknown.error).toBe('no device "Garage", "Attic"');
    expect(resolveTargetDevices(devices, ["Twin"]).ok).toBe(false);
    for (const bad of [[], [""], [3], {}, 7]) {
      expect(resolveTargetDevices(devices, bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  test("the camera list is enabled cameras in settings order, id and name only", () => {
    const listed = listableCameras((SEED.settings[0].value as { cameras: never[] }).cameras);
    expect(listed).toEqual([
      { id: "cam-door", name: "Front door" },
      { id: "cam-garden", name: "Garden" },
    ]);
    expect(JSON.stringify(listed)).not.toContain("rtsp");
    expect(listableCameras(undefined)).toEqual([]);
  });

  test("a screen shows it only if it is a target, until the server's clock reaches the end", () => {
    const row: CameraTakeoverRow = {
      family_id: FAMILY,
      camera_id: "cam-door",
      device_ids: [WALL],
      started_at: "2026-10-02T18:00:00.000Z",
      ends_at: "2026-10-02T18:01:00.000Z",
    };
    const at = (iso: string) => new Date(iso);
    expect(activeTakeover(row, WALL, at("2026-10-02T18:00:30Z"))).toBe(row);
    expect(activeTakeover(row, PHONE, at("2026-10-02T18:00:30Z"))).toBeNull();
    expect(activeTakeover(row, null, at("2026-10-02T18:00:30Z"))).toBeNull();
    expect(activeTakeover(row, WALL, at("2026-10-02T18:01:00Z"))).toBeNull();
    expect(activeTakeover(null, WALL, at("2026-10-02T18:00:30Z"))).toBeNull();
    expect(takeoverRemainingMs(row, at("2026-10-02T18:00:45Z"))).toBe(15_000);
    expect(takeoverRemainingMs(row, at("2026-10-02T18:02:00Z"))).toBe(0);
  });

  test("a camera on the screen keeps the screensaver off", () => {
    const idle = { isIdle: true, skipPath: false, handheld: false, ringingTimer: false, takeoverMessage: false, pendingAssistantActions: 0 };
    expect(screensaverAllowed(idle)).toBe(true);
    expect(screensaverAllowed({ ...idle, cameraTakeover: false })).toBe(true);
    expect(screensaverAllowed({ ...idle, cameraTakeover: true })).toBe(false);
  });
});

test.describe("show_camera: the service", () => {
  test("is an announcement, with a budget of its own like messages", () => {
    expect(SERVICES.show_camera.scope).toBe("announcements:write");
    expect(SERVICES.show_camera.rateLimit).toEqual({ limit: SHOW_CAMERA_RATE_LIMIT, windowMs: SHOW_CAMERA_RATE_WINDOW_MS });
    expect(SHOW_CAMERA_RATE_LIMIT).toBe(5);
  });

  test("puts the camera on this family's kiosk screens for a minute and queues the push", async () => {
    const before = Date.now();
    const { status, response, writes } = await call({ camera: "Front door" });
    expect(status).toBe(200);
    expect(response).toMatchObject({ camera: { id: "cam-door", name: "Front door" }, screens: 2 });
    expect(JSON.stringify(response)).not.toContain("rtsp");

    const takeover = writes.find((w) => w.table === "camera_takeovers");
    expect(takeover?.op).toBe("upsert");
    expect(takeover?.options).toEqual({ onConflict: "family_id" });
    expect(takeover?.row).toMatchObject({ family_id: FAMILY, camera_id: "cam-door", device_ids: [WALL, HALL] });
    const started = Date.parse(takeover!.row.started_at as string);
    expect(started).toBeGreaterThanOrEqual(before);
    expect(Date.parse(takeover!.row.ends_at as string) - started).toBe(60_000);
    expect(response.ends_at).toBe(takeover!.row.ends_at);

    const push = writes.find((w) => w.table === "scheduled_notifications");
    expect(push?.row).toMatchObject({
      family_id: FAMILY,
      notification_type: "camera_live",
      scheduled_for: takeover!.row.started_at,
      data: { camera_id: "cam-door", camera_name: "Front door" },
    });
  });

  test("named screens replace the kiosks, and the push still goes out", async () => {
    const { status, response, writes } = await call({ camera: "cam-garden", duration: 30, target_devices: ["Phone"] });
    expect(status).toBe(200);
    expect(response.screens).toBe(1);
    const takeover = writes.find((w) => w.table === "camera_takeovers")!;
    expect(takeover.row.device_ids).toEqual([PHONE]);
    expect(Date.parse(takeover.row.ends_at as string) - Date.parse(takeover.row.started_at as string)).toBe(30_000);
    expect(writes.some((w) => w.table === "scheduled_notifications")).toBe(true);
  });

  test("a bad call writes nothing", async () => {
    for (const body of [
      { camera: "Nope" },
      { camera: "cam-theirs" },
      { camera: "Old" },
      { camera: "Front door", duration: 0 },
      { camera: "Front door", target_devices: ["Garage"] },
      {},
    ]) {
      const { status, response, writes } = await call(body);
      expect(status, JSON.stringify(body)).toBe(400);
      expect(response.code).toBe("invalid_request");
      expect(writes, JSON.stringify(body)).toEqual([]);
    }
  });
});

test.describe("show_camera: the wiring", () => {
  const read = (...path: string[]) => readFileSync(join(__dirname, "..", ...path), "utf8");

  test("the screens can read the table and hear about it live", () => {
    expect(read("docker", "migration_camera_takeovers.sql")).toContain("ADD TABLE public.camera_takeovers");
    expect(read("docker", "migration_zz_row_level_security.sql")).toContain("'camera_takeovers'");
    expect(read("src", "hooks", "use-realtime.ts")).toMatch(/ALL_TABLES[\s\S]*"camera_takeovers"/);
  });

  test("the push opens that camera, in every language", () => {
    expect(read("src", "app", "api", "cron", "process-notifications", "route.ts")).toContain('case "camera_live"');
    for (const locale of ["en", "de", "fr"]) {
      const push = JSON.parse(read("messages", `${locale}.json`)).push;
      expect(push.cameraLiveTitle, locale).toContain("{camera}");
      expect(String(push.cameraLiveBody).length, locale).toBeGreaterThan(0);
    }
  });
});
