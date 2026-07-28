import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  adminCookieOptions,
  createAdminToken,
  resolveAdminAuth,
} from "@/lib/admin-auth";

export const runtime = "nodejs";

async function establishSession(request: Request, key: string | null) {
  const jar = await cookies();
  const auth = resolveAdminAuth({
    cookieToken: jar.get(ADMIN_COOKIE_NAME)?.value,
    authorization: request.headers.get("authorization"),
    key,
  });

  if (!auth.ok) {
    if (auth.reason === "disabled") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Bloom Admin", charset="UTF-8"',
        },
      },
    );
  }

  const response = NextResponse.redirect(new URL("/admin30910", request.url));
  const options = adminCookieOptions();
  response.cookies.set(options.name, createAdminToken(), {
    httpOnly: options.httpOnly,
    sameSite: options.sameSite,
    secure: options.secure,
    path: options.path,
    maxAge: options.maxAge,
  });
  return response;
}

/** `GET /api/admin30910/login?key=…` — sets cookie and redirects to the dashboard. */
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  return establishSession(request, key);
}

/** `POST /api/admin30910/login` with form/JSON field `key`, or Basic auth. */
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  let key: string | null = null;

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    const value = form.get("key");
    key = typeof value === "string" ? value : null;
  } else if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as {
      key?: unknown;
    } | null;
    key = typeof body?.key === "string" ? body.key : null;
  }

  return establishSession(request, key);
}
