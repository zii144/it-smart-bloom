/**
 * Booth camera open helpers.
 * Keep this boring: soft constraints, clear errors, no Permissions-Policy tricks.
 */

export const CAMERA_CONSTRAINT_ATTEMPTS: MediaStreamConstraints[] = [
  // Soft front-camera preference first — no hard resolution requirements.
  {
    video: { facingMode: { ideal: "user" } },
    audio: false,
  },
  // Any camera (desktop webcams often omit facingMode metadata).
  { video: true, audio: false },
  // Last: original booth preference with soft size hints.
  {
    video: {
      facingMode: { ideal: "user" },
      width: { ideal: 1280 },
      height: { ideal: 1280 },
    },
    audio: false,
  },
];

function isRetryableCameraError(error: unknown) {
  if (!(error instanceof DOMException)) return false;
  return (
    error.name === "OverconstrainedError" ||
    error.name === "ConstraintNotSatisfiedError" ||
    error.name === "NotFoundError" ||
    error.name === "DevicesNotFoundError"
  );
}

export function describeCameraError(error: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "相機需要 HTTPS（或本機 localhost）。手機請用正式網址，不要用 http://192.168… 開啟。";
  }

  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "相機權限遭到封鎖。請點網址列左側的鎖頭／網站設定，允許相機後重新整理再試。";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "瀏覽器找不到相機裝置。請到系統「隱私權與安全性 → 相機」允許此瀏覽器，並關閉占用相機的 App 後重試。";
      case "NotReadableError":
      case "TrackStartError":
        return "相機正被其他應用程式使用，請關閉後再試一次。";
      case "OverconstrainedError":
      case "ConstraintNotSatisfiedError":
        return "目前相機不支援所需設定，請改用其他瀏覽器再試。";
      case "SecurityError":
        return "瀏覽器基於安全理由拒絕開啟相機，請使用 HTTPS 開啟本頁。";
      default:
        return `無法開啟相機（${error.name}），請再試一次。`;
    }
  }

  return "無法開啟相機，請再試一次。";
}

type CameraAccessDeps = {
  getUserMedia?: MediaDevices["getUserMedia"];
  isSecureContext?: boolean;
};

export async function requestUserCamera(
  deps: CameraAccessDeps = {},
): Promise<MediaStream> {
  const secure =
    deps.isSecureContext ??
    (typeof window !== "undefined" ? window.isSecureContext : true);

  if (!secure) {
    throw new DOMException(
      "Camera requires a secure context.",
      "SecurityError",
    );
  }

  const getUserMedia =
    deps.getUserMedia ??
    navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

  let lastError: unknown = new DOMException(
    "No camera constraints succeeded.",
    "NotFoundError",
  );

  for (const constraints of CAMERA_CONSTRAINT_ATTEMPTS) {
    try {
      return await getUserMedia(constraints);
    } catch (error) {
      lastError = error;
      if (!isRetryableCameraError(error)) {
        throw error;
      }
    }
  }

  throw lastError;
}
