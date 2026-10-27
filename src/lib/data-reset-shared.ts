/**
 * What the admin data reset can clear, shared by the server reset and the
 * dashboard panel. Pure on purpose: the panel runs in the browser.
 */
export const RESET_CATEGORIES = [
  {
    key: "roster",
    label: "名單",
    description: "刪除所有來賓資料（含報到與作品連結），並清除上次匯入紀錄。",
  },
  {
    key: "checkIns",
    label: "報到紀錄",
    description: "保留來賓，只清除報到時間、報到方式與作品領取連結，並關閉報到。",
  },
  {
    key: "portraits",
    label: "似顏繪",
    description: "刪除所有創作紀錄、雲端儲存的照片與作品，以及來賓的作品狀態；所有來賓可重新上傳照片。",
  },
  {
    key: "usage",
    label: "用量統計",
    description: "清除每日生成張數與花費統計。",
  },
] as const;

export type ResetCategory = (typeof RESET_CATEGORIES)[number]["key"];

/** Typed by the admin, and checked again on the server. */
export const RESET_CONFIRMATION = "確認重置";

export type ResetCounts = {
  rosterEntries?: number;
  checkInsCleared?: number;
  sessions?: number;
  identities?: number;
  storageFiles?: number;
  localSessions?: number;
  portraitLinksCleared?: number;
  usageDays?: number;
};

export type ResetLog = {
  at: string;
  categories: ResetCategory[];
  counts: ResetCounts;
  environment: "emulator" | "live";
};

