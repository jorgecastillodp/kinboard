/**
 * The Permissions-Policy for one page load (lib/microphone-policy.ts), from
 * the family the request's session belongs to. Server only: src/proxy.ts
 * calls it for page loads, never for assets or API calls.
 *
 * Fails closed: no session, an expired one, a database error, anything
 * unexpected, and the page gets the default policy (no microphone).
 *
 * Cached for a minute per session, so a display doesn't read the database on
 * every page; a family's entries are dropped when its Home Assistant settings
 * are saved (api/settings). The cache sits on globalThis because the proxy and
 * the API routes are bundled apart and would otherwise each have their own.
 */
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import { DEFAULT_PERMISSIONS_POLICY, microphoneOrigin, permissionsPolicy } from "@/lib/microphone-policy";

const TTL_MS = 60_000;
const MAX_ENTRIES = 1000;

interface Entry {
  familyId: string | null;
  policy: string;
  until: number;
}

const store = globalThis as unknown as { __kinboardMicrophonePolicy?: Map<string, Entry> };
const cache = (store.__kinboardMicrophonePolicy ??= new Map<string, Entry>());

/** A session token is a credential: the cache keys on its hash. */
const keyOf = (token: string) => createHash("sha256").update(token).digest("hex");

export async function permissionsPolicyFor(cookies: { get(name: string): { value: string } | undefined }): Promise<string> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return DEFAULT_PERMISSIONS_POLICY;
  const key = keyOf(token);
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.policy;
  try {
    const session = await verifySession(token);
    let policy = DEFAULT_PERMISSIONS_POLICY;
    if (session) {
      const { data, error } = await (createAdminClient() as any)
        .from("settings")
        .select("value")
        .eq("family_id", session.familyId)
        .eq("key", SETTINGS_KEYS.homeAssistant)
        .maybeSingle();
      if (!error) policy = permissionsPolicy(microphoneOrigin(data?.value ?? null));
    }
    if (cache.size >= MAX_ENTRIES) cache.clear();
    cache.set(key, { familyId: session?.familyId ?? null, policy, until: Date.now() + TTL_MS });
    return policy;
  } catch {
    return DEFAULT_PERMISSIONS_POLICY;
  }
}

/** Forget a family's cached policies: its Home Assistant settings changed. */
export function forgetMicrophonePolicy(familyId: string): void {
  for (const [key, entry] of cache) if (entry.familyId === familyId) cache.delete(key);
}
