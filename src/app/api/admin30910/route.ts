import {
  ADMIN_COOKIE_NAME,
  resolveAdminAuth,
} from "@/lib/admin-auth";
import { getAdminHealth } from "@/lib/admin-health";
import { defaultImageOptions } from "@/lib/image-options";
import { listArchiveSessions } from "@/lib/portrait-archive";
import { listLocalSessions } from "@/lib/sessions";

export const runtime = "nodejs";

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

export async function GET(request: Request) {
  const auth = resolveAdminAuth({
    cookieToken: readCookie(request, ADMIN_COOKIE_NAME),
    authorization: request.headers.get("authorization"),
    key: new URL(request.url).searchParams.get("key"),
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

  const [local, archive] = await Promise.all([
    listLocalSessions({ limit: 50 }),
    listArchiveSessions({ limit: 50 }),
  ]);

  return Response.json(
    {
      health: getAdminHealth(),
      imageDefaults: defaultImageOptions(),
      localSessions: local.map((session) => ({
        id: session.id,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.generationStartedAt ?? session.createdAt,
        identity: session.identity
          ? `${session.identity.kind}:${session.identity.value}`
          : null,
        avatarRequestStatus: null,
        fakeGenerate: Boolean(session.generationOptions?.fakeGenerate),
        source: session.source ?? null,
        error: session.error ?? null,
        inputUrl: `/api/sessions/${session.id}/image?kind=input`,
        resultUrl:
          session.status === "complete"
            ? `/api/sessions/${session.id}/image?kind=result`
            : null,
      })),
      archiveSessions: archive.sessions.map((session) => ({
        id: session.sessionId,
        status: session.status,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        identity:
          session.identityKind && session.identityValue
            ? `${session.identityKind}:${session.identityValue}`
            : null,
        avatarRequestStatus: session.avatarRequestStatus,
        fakeGenerate: null,
        source: session.source ?? null,
        error: session.error,
        inputUrl: session.storage.inputPath
          ? `/api/admin30910/sessions/${session.sessionId}/image?kind=input`
          : null,
        resultUrl: session.storage.resultPath
          ? `/api/admin30910/sessions/${session.sessionId}/image?kind=result`
          : null,
      })),
      archiveError: archive.error,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
