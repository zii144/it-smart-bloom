#!/usr/bin/env node
/**
 * READ-ONLY on the site. Saves every guest's portrait into a local folder,
 * named {座位}_{姓名}_{來賓編號}.{ext} — the names upload.mjs matches back.
 *
 *   node download.mjs --out ./originals            the generated originals (to retouch)
 *   node download.mjs --out ./current --current    what guests get now, adjustments included
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  api,
  extensionForType,
  guestLabel,
  hasFailedPortrait,
  hasPortrait,
  loadRoster,
  main,
  originalFilename,
  readError,
  runPool,
} from "./lib.mjs";

const CONCURRENCY = 4;

await main(async (args) => {
  if (typeof args.out !== "string") throw new Error("請用 --out 指定要存放的資料夾。");
  const kind = args.current ? "result" : "generated";
  const { entries } = await loadRoster();
  const guests = entries.filter(hasPortrait);
  await mkdir(args.out, { recursive: true });

  let saved = 0;
  const failed = [];
  await runPool(guests, CONCURRENCY, async (guest) => {
    try {
      // The route streams small files and redirects big ones to a signed URL; fetch follows.
      const response = await api(
        `/api/admin30910/sessions/${guest.portraitSessionId}/image?kind=${kind}&original=1`,
      );
      if (!response.ok) throw new Error(await readError(response));
      const bytes = Buffer.from(await response.arrayBuffer());
      const name = originalFilename(guest, extensionForType(response.headers.get("content-type")));
      await writeFile(path.join(args.out, name), bytes);
      saved += 1;
    } catch (error) {
      failed.push(`${guestLabel(guest)}（${error instanceof Error ? error.message : error}）`);
    }
  });

  console.log(`已存 ${saved}/${guests.length} 張${kind === "result" ? "目前版本" : "原圖"}到 ${path.resolve(args.out)}`);
  const noOriginal = entries.filter(hasFailedPortrait);
  if (noOriginal.length) {
    console.log(
      `\n生成失敗、沒有原圖（${noOriginal.length}）。修好的圖可直接上傳補上，檔名請用：\n- ${noOriginal
        .map((entry) => originalFilename(entry, "jpg"))
        .join("\n- ")}`,
    );
  }
  if (failed.length) {
    console.log(`下載失敗（${failed.length}）：\n- ${failed.join("\n- ")}`);
    process.exitCode = 2;
  }
});
