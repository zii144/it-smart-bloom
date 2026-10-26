import { adminRouteGuard } from "@/lib/admin-route";
import { RosterInputError, summarizeRosterImport } from "@/lib/roster";
import { rosterErrorResponse, rosterJson } from "@/lib/roster-http";
import { applyRosterImport, previewRosterImport } from "@/lib/roster-store";
import { parseRosterWorkbook } from "@/lib/roster-xlsx";

export const runtime = "nodejs";

/**
 * `POST /api/admin30910/roster/import` with multipart fields `file` (.xlsx) and
 * `mode` (`preview` | `apply`). Apply re-reads the file and re-plans against
 * Firestore, so a stale preview can never write outdated changes.
 */
export async function POST(request: Request) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const mode = form?.get("mode");
    if (!(file instanceof File)) {
      throw new RosterInputError("請選擇一個 Excel 檔案。");
    }
    if (mode !== "preview" && mode !== "apply") {
      throw new RosterInputError("未知的匯入模式。");
    }

    const parsed = await parseRosterWorkbook(file);
    const plan =
      mode === "apply"
        ? await applyRosterImport(parsed)
        : await previewRosterImport(parsed);
    return rosterJson(summarizeRosterImport(mode, plan));
  } catch (error) {
    return rosterErrorResponse(error, "import roster");
  }
}
