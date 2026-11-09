#!/usr/bin/env node
/**
 * READ-ONLY. Where the adjusted-portrait work stands, and whether check-in
 * may be opened. Never changes anything.
 *
 *   node status.mjs           summary + who is left
 *   node status.mjs --json    the same as JSON
 */
import {
  BASE_URL,
  guestLabel,
  hasFailedPortrait,
  hasNoPortrait,
  hasPortrait,
  loadRoster,
  loadSubmissions,
  main,
  originalFilename,
} from "./lib.mjs";

await main(async (args) => {
  const [{ entries, checkIn }, submissions] = await Promise.all([loadRoster(), loadSubmissions()]);
  const portraits = entries.filter(hasPortrait);
  const adjusted = portraits.filter((entry) => entry.portraitAdjustedAt);
  const unadjusted = portraits.filter((entry) => !entry.portraitAdjustedAt);
  const failed = entries.filter(hasFailedPortrait);
  const painting = entries.filter(
    (entry) => entry.portraitStatus === "ready" || entry.portraitStatus === "generating",
  );
  const arrived = entries.filter((entry) => entry.checkedInAt);
  // Not a blocker: absent guests never send one, and check-in still works for them.
  const noPhoto = entries.filter(hasNoPortrait);

  const blockers = [];
  if (failed.length) blockers.push(`${failed.length} 位生成失敗，先重新生成或直接上傳調整版補上`);
  if (painting.length) blockers.push(`${painting.length} 位仍在生成中`);
  if (unadjusted.length) blockers.push(`${unadjusted.length} 位還沒上傳調整版`);
  if (submissions.open) blockers.push("照片收件仍開放中（應為「照片已截止收件」）");
  const readyToOpen = blockers.length === 0;

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          site: BASE_URL,
          guests: entries.length,
          withPortrait: portraits.length,
          adjusted: adjusted.length,
          unadjusted: unadjusted.map(guestLabel),
          failed: failed.map(guestLabel),
          failedFileNames: failed.map((entry) => originalFilename(entry, "jpg")),
          painting: painting.map(guestLabel),
          noPhoto: noPhoto.map(guestLabel),
          noPhotoFileNames: noPhoto.map((entry) => originalFilename(entry, "jpg")),
          checkInOpen: checkIn.open,
          photoSubmissionsOpen: submissions.open,
          checkedIn: arrived.length,
          readyToOpenCheckIn: readyToOpen,
          blockers,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`網站：${BASE_URL}`);
  console.log(`來賓 ${entries.length} 位｜有作品 ${portraits.length}｜已調整 ${adjusted.length}/${portraits.length}`);
  console.log(`簽到：${checkIn.open ? "開放中" : "未開放"}（已簽到 ${arrived.length}）｜照片收件：${submissions.open ? "收件中" : "已截止"}`);
  if (failed.length) {
    console.log(`\n生成失敗（${failed.length}）：${failed.map(guestLabel).join("、")}`);
    // No generated original to download, so the file name with the guest id comes from here.
    console.log(
      `可直接上傳調整版補上作品（不需重新生成），檔名請用：\n- ${failed.map((entry) => originalFilename(entry, "jpg")).join("\n- ")}`,
    );
  }
  if (painting.length) console.log(`\n生成中（${painting.length}）：${painting.map(guestLabel).join("、")}`);
  if (noPhoto.length) {
    console.log(`\n沒有上傳照片（${noPhoto.length}，簽到時只記錄出席）：${noPhoto.map(guestLabel).join("、")}`);
    console.log("要給其中某位作品，可直接上傳一張圖建立作品，檔名用 status.mjs --json 的 noPhotoFileNames。");
  }
  if (unadjusted.length) console.log(`\n未調整（${unadjusted.length}）：${unadjusted.map(guestLabel).join("、")}`);
  console.log(
    readyToOpen
      ? "\n結論：條件都已滿足，可以請負責人在後台開放簽到。"
      : `\n結論：還不能開放簽到。${blockers.join("；")}。`,
  );
});
