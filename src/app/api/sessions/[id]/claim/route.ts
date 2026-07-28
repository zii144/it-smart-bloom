import { IdentityError, parseGuestIdentity } from "@/lib/guest-identity";
import { claimSessionIdentity } from "@/lib/portrait-archive";
import {
  getSession,
  publicSession,
  readInputImage,
  readResultImage,
  SessionError,
  updateSession,
} from "@/lib/sessions";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await getSession(id);
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!body) {
      return Response.json({ error: "請提供身分資料。" }, { status: 400 });
    }

    const identity = parseGuestIdentity(body);

    if (session.identity) {
      return Response.json(publicSession(session), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const input = await readInputImage(id);
    let result: { bytes: Buffer; mime: string } | null = null;
    if (session.status === "complete") {
      try {
        result = await readResultImage(id);
      } catch {
        result = null;
      }
    }

    await claimSessionIdentity(session, identity, { input, result });

    const claimed = await updateSession(id, {
      identity: {
        kind: identity.kind,
        value: identity.value,
        claimedAt: new Date().toISOString(),
      },
    });

    return Response.json(publicSession(claimed), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof IdentityError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SessionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to claim session identity:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "無法保存身分資料，請稍後再試。",
      },
      { status: 500 },
    );
  }
}
