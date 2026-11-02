#!/usr/bin/env node
/**
 * READ-ONLY. Where the adjusted-portrait work stands, and whether check-in
 * may be opened. Never changes anything.
 *
 *   node status.mjs           summary + who is left
 *   node status.mjs --json    the same as JSON
 */
import { BASE_URL, guestLabel, hasPortrait, loadRoster, loadSubmissions, main } from "./lib.mjs";

await main(async (args) => {
  const [{ entries, checkIn }, submissions] = await Promise.all([loadRoster(), loadSubmissions()]);
  const portraits = entries.filter(hasPortrait);
  const adjusted = portraits.filter((entry) => entry.portraitAdjustedAt);
  const unadjusted = portraits.filter((entry) => !entry.portraitAdjustedAt);
  const failed = entries.filter((entry) => entry.portraitStatus === "failed" && entry.portraitSessionId);
  const painting = entries.filter(
    (entry) => entry.portraitStatus === "ready" || entry.portraitStatus === "generating",
  );
  const arrived = entries.filter((entry) => entry.checkedInAt);

  const blockers = [];
  if (failed.length) blockers.push(`${failed.length} 位生成失敗，先重新生成`);
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
          painting: painting.map(guestLabel),
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
  if (failed.length) console.log(`\n生成失敗（${failed.length}）：${failed.map(guestLabel).join("、")}`);
  if (painting.length) console.log(`\n生成中（${painting.length}）：${painting.map(guestLabel).join("、")}`);
  if (unadjusted.length) console.log(`\n未調整（${unadjusted.length}）：${unadjusted.map(guestLabel).join("、")}`);
  console.log(
    readyToOpen
      ? "\n結論：條件都已滿足，可以請負責人在後台開放簽到。"
      : `\n結論：還不能開放簽到。${blockers.join("；")}。`,
  );
});
