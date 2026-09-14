import { errorResponse } from "@/lib/api-errors";
import { getSession, publicSession } from "@/lib/sessions";

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
    return errorResponse(error, "Failed to read session", {
      message: "無法讀取這個創作空間。",
    });
  }
}
