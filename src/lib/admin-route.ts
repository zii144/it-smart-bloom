import { ADMIN_COOKIE_NAME, resolveAdminAuth } from "@/lib/admin-auth";

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

/**
 * Same-origin check for writes. The admin cookie is SameSite=Lax, which already
 * keeps it off cross-site POSTs; this is a second lock for routes that change
 * the roster. Requests without an Origin header (curl, Basic auth) pass.
 */
function isCrossOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

/** Returns an error response when the caller is not an admin, else null. */
export function adminRouteGuard(request: Request): Response | null {
  const auth = resolveAdminAuth({
    cookieToken: readCookie(request, ADMIN_COOKIE_NAME),
    authorization: request.headers.get("authorization"),
  });

  if (!auth.ok) {
    if (auth.reason === "disabled") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Bloom Admin", charset="UTF-8"',
          "Cache-Control": "no-store",
        },
      },
    );
  }

  if (request.method !== "GET" && request.method !== "HEAD" && isCrossOrigin(request)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}
