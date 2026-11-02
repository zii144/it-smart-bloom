#!/usr/bin/env node
/**
 * Re-runs failed portraits from each guest's stored photo. Costs OpenAI
 * credits, so it is a dry run unless a person approved the exact count.
 *
 *   node regenerate.mjs                        DRY RUN: who would be regenerated
 *   node regenerate.mjs --apply --expect 13    regenerate, one guest at a time
 *
 * Stops at the first credit, daily-limit or API-key problem: every later
 * guest would fail the same way.
 */
import { api, guestLabel, loadRoster, main, readError } from "./lib.mjs";

const STOP = /額度|上限|金鑰|Unauthorized/;

await main(async (args) => {
  const { entries } = await loadRoster();
  const failed = entries.filter((entry) => entry.portraitStatus === "failed" && entry.portraitSessionId);
  if (!failed.length) {
    console.log("沒有生成失敗的來賓。");
    return;
  }
  console.log(`生成失敗（${failed.length}）：${failed.map(guestLabel).join("、")}`);

  if (!args.apply) {
    console.log(`\n這是預覽，沒有生成任何作品。每位約 30–90 秒、會使用 OpenAI 額度。確認後執行：--apply --expect ${failed.length}`);
    return;
  }
  if (Number(args.expect) !== failed.length) {
    throw new Error(
      `--expect ${args.expect ?? "（未提供）"} 與失敗人數 ${failed.length} 不符；請重新預覽並取得確認，沒有生成任何作品。`,
    );
  }

  let done = 0;
  const problems = [];
  for (const [index, entry] of failed.entries()) {
    console.log(`生成中 ${index + 1}/${failed.length}：${guestLabel(entry)}…`);
    const response = await api(`/api/admin30910/roster/${entry.id}/regenerate`, { method: "POST" });
    if (response.ok) {
      done += 1;
      continue;
    }
    const message = await readError(response);
    problems.push(`${guestLabel(entry)}：${message}`);
    if (STOP.test(message)) {
      console.log(`已停止：${message}`);
      break;
    }
  }
  console.log(`\n完成 ${done}/${failed.length} 位。`);
  if (problems.length) {
    console.log(`失敗：\n- ${problems.join("\n- ")}`);
    process.exitCode = 2;
  }
});
