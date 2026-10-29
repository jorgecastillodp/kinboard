import { expect, test } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";
import { DEFAULT_PERMISSIONS_POLICY, microphoneOrigin, permissionsPolicy } from "../src/lib/microphone-policy";
import { codeOnly } from "./source-helpers";

/**
 * Kinboard's Permissions-Policy: no camera, microphone or location by
 * default, and the microphone for exactly a family's own Home Assistant
 * address when the family allowed it for one of its dashboard tabs; never
 * for Kinboard's own page. The rules, and how the proxy, the settings route
 * and the frame use them. automation-layout.spec.ts asks a real browser.
 */

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const tab = (over: Record<string, unknown> = {}) => ({ id: "t", title: "Announce", path: "dashboard-announce", hide_sidebar: true, hide_header: true, ...over });
const settings = (over: Record<string, unknown>, tabs = [tab({ allow_microphone: true })]) =>
  ({ url: "http://homeassistant.local:8123", embedded_dashboards: tabs, ...over }) as never;

test("by default nothing may use the camera, the microphone or the location", () => {
  expect(DEFAULT_PERMISSIONS_POLICY).toBe("camera=(), microphone=(), geolocation=(), interest-cohort=()");
  expect(permissionsPolicy(null)).toBe(DEFAULT_PERMISSIONS_POLICY);
});

test("allowed, the microphone goes to that one address: never Kinboard itself, never everyone", () => {
  const policy = permissionsPolicy("https://ha.example.org");
  expect(policy).toBe('camera=(), microphone=("https://ha.example.org"), geolocation=(), interest-cohort=()');
  expect(policy).not.toMatch(/self|\*/);
});

test("only when a tab is switched on, and only the origin of the address the tabs open at", () => {
  expect(microphoneOrigin(null)).toBeNull();
  expect(microphoneOrigin(settings({}, [tab()]))).toBeNull();
  expect(microphoneOrigin(settings({}, [tab({ allow_microphone: "true" })]))).toBeNull();
  expect(microphoneOrigin(settings({}, [tab(), tab({ id: "u", allow_microphone: true })]))).toBe("http://homeassistant.local:8123");
  // The browser's address wins over the server's, as for the frame.
  expect(microphoneOrigin(settings({ embed_url: "https://ha.example.org/some/path?x=1#y" }))).toBe("https://ha.example.org");
  expect(microphoneOrigin(settings({ embed_url: "https://ha.example.org:8443/" }))).toBe("https://ha.example.org:8443");
  // No address, or one a browser shouldn't be sent to: nobody.
  expect(microphoneOrigin(settings({ url: "" }))).toBeNull();
  expect(microphoneOrigin(settings({ embed_url: "https://user:secret@ha.example.org" }))).toBeNull();
  expect(microphoneOrigin(settings({ url: "ftp://ha.example.org", embed_url: "" }))).toBeNull();
  expect(microphoneOrigin(settings({ embed_url: "javascript:alert(1)" }))).toBeNull();
});

test("nothing a family typed can add to the header or break out of it", () => {
  for (const attempt of [
    'https://ha.example.org/"), camera=*',
    'https://ha.example.org", camera=(*',
    "https://ha.example.org\r\nSet-Cookie: x=1",
    "https://ha.example.org?), camera=*",
  ]) {
    const origin = microphoneOrigin(settings({ embed_url: attempt }));
    if (origin !== null) expect(origin, attempt).toBe("https://ha.example.org");
    expect(permissionsPolicy(origin), attempt).not.toMatch(/camera=\*|Set-Cookie|\r|\n/);
  }
});

test("two families on one server: each its own address", () => {
  expect(microphoneOrigin(settings({ embed_url: "https://ha.one.example" }))).toBe("https://ha.one.example");
  expect(microphoneOrigin(settings({ embed_url: "https://ha.two.example" }))).toBe("https://ha.two.example");
  expect(microphoneOrigin(settings({ embed_url: "https://ha.three.example" }, [tab()]))).toBeNull();
});

test("the proxy sends it: the default on everything, the family's own on a page load, the default on any failure", () => {
  const proxy = codeOnly(read("src/proxy.ts"));
  expect(proxy).toContain('response.headers.set("Permissions-Policy", policy);');
  expect(proxy).toContain("let policy = DEFAULT_PERMISSIONS_POLICY;");
  expect(proxy).toMatch(/if \(pageLoad\) \{\s*try \{\s*policy = await permissionsPolicyFor\(request\.cookies\);\s*\} catch \{\s*policy = DEFAULT_PERMISSIONS_POLICY;/);
  expect(proxy).toContain('request.headers.get("sec-fetch-dest") === "document"');
  // The header is set after the Supabase cookie refresh, which replaces the response.
  expect(proxy.indexOf('response.headers.set("Permissions-Policy"')).toBeGreaterThan(proxy.indexOf("setAll("));
  // And nowhere else: next.config.mjs no longer sends one.
  expect(read("next.config.mjs")).not.toMatch(/key: "Permissions-Policy"/);

  const server = codeOnly(read("src/lib/microphone-policy-server.ts"));
  expect(server).toContain("if (!token) return DEFAULT_PERMISSIONS_POLICY;");
  expect(server).toContain("const session = await verifySession(token);");
  expect(server).toMatch(/\.eq\("family_id", session\.familyId\)\s*\.eq\("key", SETTINGS_KEYS\.homeAssistant\)/);
  expect(server).toMatch(/\} catch \{\s*return DEFAULT_PERMISSIONS_POLICY;\s*\}/);
  // The session token is a credential: never a cache key as it is.
  expect(server).toContain('createHash("sha256").update(token).digest("hex")');
  expect(server).toContain("const TTL_MS = 60_000;");
  expect(server).toContain("store.__kinboardMicrophonePolicy ??= new Map");
});

test("saving or deleting the Home Assistant settings drops the family's cached policy", () => {
  const route = codeOnly(read("src/app/api/settings/route.ts"));
  expect(route.match(/if \(key === SETTINGS_KEYS\.homeAssistant\) forgetMicrophonePolicy\(family_id\);/g)?.length).toBe(2);
});

test("a tab switched on after the page loaded says to reload, where the browser can tell", () => {
  const frame = codeOnly(read("src/components/home-assistant/ha-dashboard-frame.tsx"));
  expect(frame).toContain('const allowed = policy.getAllowlistForFeature("microphone");');
  expect(frame).toContain('setMicNeedsReload(!allowed.includes("*") && !allowed.includes(new URL(src).origin));');
  expect(frame).toContain("onClick={() => window.location.reload()}");
});
