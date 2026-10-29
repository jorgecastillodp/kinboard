import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  CORRELATION_HEADER,
  newCorrelationId,
  sanitiseCorrelationId,
} from "@/lib/correlation";
import { serverSupabaseUrl } from "@/lib/supabase/api-base";
import { DEFAULT_PERMISSIONS_POLICY } from "@/lib/microphone-policy";
import { permissionsPolicyFor } from "@/lib/microphone-policy-server";

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

export async function proxy(request: NextRequest) {
  // Correlation ID, attached before anything else so it is available even if
  // the Supabase refresh below throws.
  //
  // This lives here rather than in a middleware.ts of its own: Next 16 renamed
  // middleware to proxy, and having both files is a hard build error —
  //   "Both middleware file and proxy file are detected."
  // One file per project, so the ID is set here.
  //
  // An inbound header is honoured rather than replaced, so an ID minted by
  // Home Assistant, the Bridge or a reverse proxy survives the hop and one ID
  // covers the whole chain. Sanitised first: it is echoed into log lines and
  // into a response header, so an unbounded caller-controlled string would be
  // a log-injection and header-splitting vector.
  const correlationId =
    sanitiseCorrelationId(request.headers.get(CORRELATION_HEADER)) ?? newCorrelationId();
  request.headers.set(CORRELATION_HEADER, correlationId);

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // Server side: the internal address, never the browser's (RFC-018).
  const supabase = createServerClient(
    serverSupabaseUrl(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Check for family session in localStorage (handled client-side)
  // This proxy primarily refreshes Supabase tokens if needed

  // Back to the caller too, so a client can log the ID without parsing a body
  // — including on responses that have none. Set last: the Supabase cookie
  // handling above replaces `response` wholesale when it refreshes a token,
  // which would drop a header set any earlier.
  response.headers.set(CORRELATION_HEADER, correlationId);

  // The Permissions-Policy (lib/microphone-policy.ts): the default on
  // everything, and on a page load the family's own, which may let its Home
  // Assistant address have the microphone. Only a page load reads the
  // session: the policy belongs to the document, and assets and API calls
  // don't open one. Any failure there gives the default.
  const pageLoad =
    request.method === "GET" &&
    (request.headers.get("sec-fetch-dest") === "document" ||
      (!request.headers.has("rsc") && (request.headers.get("accept") ?? "").includes("text/html")));
  let policy = DEFAULT_PERMISSIONS_POLICY;
  if (pageLoad) {
    try {
      policy = await permissionsPolicyFor(request.cookies);
    } catch {
      policy = DEFAULT_PERMISSIONS_POLICY;
    }
  }
  response.headers.set("Permissions-Policy", policy);

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
