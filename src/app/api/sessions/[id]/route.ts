import { getSession, publicSession, SessionError } from "@/lib/sessions";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await getSession(id);
    return Response.json(publicSession(session), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof SessionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error("Failed to read session:", error);
    return Response.json({ error: "無法讀取這個創作空間。" }, { status: 500 });
  }
}
