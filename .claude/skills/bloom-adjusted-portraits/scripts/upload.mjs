#!/usr/bin/env node
/**
 * Uploads retouched portraits, matched to guests by file name exactly as the
 * admin panel's batch upload does.
 *
 *   node upload.mjs --dir ./retouched                       DRY RUN: the match table only
 *   node upload.mjs --dir ./retouched --apply --expect 127  upload, after a person approved
 *
 * `--expect` must equal the number of uploadable files in the dry run, so an
 * approval for one batch can never send a different one. Every upload goes
 * through the same signed direct-to-Storage path as the panel, three at a time.
 */
import { readFile } from "node:fs/promises";
import {
  api,
  apiJson,
  guestLabel,
  listCandidateFiles,
  loadRoster,
  main,
  planAdjustedUploads,
  readError,
  runPool,
  STOP_THE_RUN,
} from "./lib.mjs";

const CONCURRENCY = 3;

async function sendAdjustedPortrait(entryId, file) {
  const base = `/api/admin30910/roster/${entryId}/portrait`;
  const target = await apiJson(`${base}/upload-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mime: file.type, size: file.size }),
  });
  const bytes = await readFile(file.path);

  if (target.mode === "signed") {
    let put;
    try {
      // Straight to Storage: no admin credentials on this request.
      put = await fetch(target.uploadUrl, { method: "PUT", headers: target.headers, body: bytes });
    } catch {
      throw new Error("無法上傳到儲存空間，請確認網路。");
    }
    if (!put.ok) throw new Error(`上傳到儲存空間失敗（${put.status}），請再試一次。`);
    await apiJson(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ objectPath: target.objectPath }),
    });
    return;
  }

  if (file.size > target.maxBytes) {
    throw new Error(`此環境只能上傳 ${Math.floor(target.maxBytes / 1024 / 1024)} MB 以下的圖片。`);
  }
  const body = new FormData();
  body.append("image", new Blob([bytes], { type: file.type }), file.name);
  const response = await api(base, { method: "POST", body });
  if (!response.ok) throw new Error(await readError(response));
}

function printPlan(rows) {
  for (const row of rows) {
    const who = row.guest
      ? `${guestLabel(row.guest)}${row.matchedBy === "seat" ? "（依座位）" : row.matchedBy === "name" ? "（依姓名）" : ""}`
      : "—";
    const status =
      row.problem ??
      (row.completesFailed ? "生成失敗，以這張補上作品" : row.replaces ? "會取代現有調整版" : "待上傳");
    console.log(`${row.problem ? "✗" : "✓"} ${row.fileName} → ${who} → ${status}`);
  }
}

await main(async (args) => {
  if (typeof args.dir !== "string") throw new Error("請用 --dir 指定修好的檔案所在資料夾。");
  const [{ entries }, files] = await Promise.all([loadRoster(), listCandidateFiles(args.dir)]);
  if (!files.length) throw new Error("資料夾裡沒有可上傳的檔案。");
  const rows = planAdjustedUploads(files, entries);
  const ready = rows.filter((row) => !row.problem);
  const byFallback = ready.filter((row) => row.matchedBy !== "id").length;
  const replacing = ready.filter((row) => row.replaces).length;
  const completing = ready.filter((row) => row.completesFailed).length;

  printPlan(rows);
  console.log(
    `\n共 ${rows.length} 個檔案：可上傳 ${ready.length}，有問題 ${rows.length - ready.length}（不會上傳）` +
      `；其中依座位或姓名配對 ${byFallback}、會取代現有調整版 ${replacing}、補上生成失敗的作品 ${completing}。`,
  );

  if (!args.apply) {
    console.log(`\n這是預覽，沒有上傳任何檔案。確認無誤後執行：--apply --expect ${ready.length}`);
    return;
  }
  if (Number(args.expect) !== ready.length) {
    throw new Error(
      `--expect ${args.expect ?? "（未提供）"} 與可上傳數 ${ready.length} 不符；請重新預覽並取得確認，沒有上傳任何檔案。`,
    );
  }

  let done = 0;
  const failures = [];
  let stopped = null;
  await runPool(
    ready,
    CONCURRENCY,
    async (row) => {
      const file = files[rows.indexOf(row)];
      try {
        await sendAdjustedPortrait(row.guest.id, file);
        done += 1;
        console.log(`完成 ${done}/${ready.length}：${row.fileName} → ${guestLabel(row.guest)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${row.fileName} → ${guestLabel(row.guest)}：${message}`);
        if (STOP_THE_RUN.test(message)) stopped = message;
      }
    },
    () => stopped !== null,
  );

  console.log(`\n完成 ${done}/${ready.length} 張${failures.length ? `，失敗 ${failures.length} 張` : ""}。`);
  if (failures.length) console.log(`失敗：\n- ${failures.join("\n- ")}`);
  if (stopped) console.log(`已停止：${stopped}。處理後重新預覽，只上傳剩下的檔案。`);
  if (failures.length || stopped) process.exitCode = 2;
});
