import { formatTaipeiDateTime } from "@/lib/event-info";
import type { PortraitStatus, RosterEntry } from "@/lib/roster";

export const PORTRAIT_LABELS: Record<PortraitStatus | "none", string> = {
  none: "尚未創作",
  ready: "等待創作",
  generating: "創作中",
  complete: "已完成",
  failed: "創作失敗",
};

export function portraitLabel(entry: Pick<RosterEntry, "portraitStatus">) {
  return PORTRAIT_LABELS[entry.portraitStatus ?? "none"];
}

/**
 * Quotes every cell, and defuses values Excel would run as a formula
 * (`=`, `+`, `-`, `@`, tab, CR) by prefixing an apostrophe.
 */
export function csvCell(value: string | number | null | undefined) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const HEADER = ["座位", "姓名", "手機", "身分", "報到狀態", "報到時間", "報到方式", "似顏繪"];

/** Arrival list for the post-event report. BOM so Excel reads it as UTF-8. */
export function buildCheckInCsv(entries: RosterEntry[]) {
  const rows = entries.map((entry) => [
    entry.seat,
    entry.name,
    entry.mobile ?? "",
    entry.role,
    entry.checkedInAt ? "已報到" : "未報到",
    entry.checkedInAt ? formatTaipeiDateTime(entry.checkedInAt) : "",
    entry.checkInSource === "admin" ? "工作人員" : entry.checkInSource === "self" ? "自助" : "",
    portraitLabel(entry),
  ]);
  return `﻿${[HEADER, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
