/**
 * Browser side of adjusted-portrait uploads, shared by the per-guest button
 * and the batch upload.
 */

export async function readError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error || `操作失敗（${response.status}）`;
}

type UploadTarget =
  | {
      mode: "signed";
      uploadUrl: string;
      objectPath: string;
      /** Signed into the URL: the PUT must send exactly these. */
      headers: Record<string, string>;
    }
  | { mode: "direct"; maxBytes: number };

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await readError(response));
  return response;
}

/**
 * Vercel rejects function bodies over 4.5 MB, so the original goes straight
 * to Storage through a signed URL and the server then checks it. Only where
 * URLs cannot be signed (local emulators) does the file pass through the API.
 */
export async function sendAdjustedPortrait(entryId: string, file: File) {
  const base = `/api/admin30910/roster/${entryId}/portrait`;
  const target = (await (
    await postJson(`${base}/upload-url`, { mime: file.type, size: file.size })
  ).json()) as UploadTarget;

  if (target.mode === "signed") {
    let put: Response;
    try {
      put = await fetch(target.uploadUrl, {
        method: "PUT",
        headers: target.headers,
        body: file,
      });
    } catch {
      throw new Error("無法上傳到儲存空間，請確認網路，或 Storage 的 CORS 設定。");
    }
    if (!put.ok) throw new Error(`上傳到儲存空間失敗（${put.status}），請再試一次。`);
    await postJson(base, { objectPath: target.objectPath });
    return;
  }

  if (file.size > target.maxBytes) {
    throw new Error(
      `此環境只能上傳 ${Math.floor(target.maxBytes / 1024 / 1024)} MB 以下的圖片。`,
    );
  }
  const body = new FormData();
  body.append("image", file);
  const response = await fetch(base, { method: "POST", body, credentials: "same-origin" });
  if (!response.ok) throw new Error(await readError(response));
}

