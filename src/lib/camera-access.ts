/** Soft → looser constraint chain so devices can prompt instead of failing cold. */
export const CAMERA_CONSTRAINT_ATTEMPTS: MediaStreamConstraints[] = [
  {
    video: {
      facingMode: { ideal: "user" },
      width: { ideal: 1280 },
      height: { ideal: 1280 },
    },
    audio: false,
  },
  {
    video: { facingMode: { ideal: "user" } },
    audio: false,
  },
  { video: true, audio: false },
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
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "相機權限遭到封鎖。請點網址列左側的鎖頭／網站設定，允許相機後再試一次。";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "找不到可用的相機，請確認裝置已連接相機。";
      case "NotReadableError":
      case "TrackStartError":
        return "相機正被其他應用程式使用，請關閉後再試一次。";
      case "OverconstrainedError":
      case "ConstraintNotSatisfiedError":
        return "目前相機不支援所需設定，請改用其他相機或瀏覽器。";
      case "SecurityError":
        return "瀏覽器基於安全理由拒絕開啟相機，請使用 HTTPS 開啟本頁。";
      default:
        break;
    }
  }

  return "無法開啟相機，請再試一次。";
}

export async function requestUserCamera(
  getUserMedia: MediaDevices["getUserMedia"] = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices,
  ),
): Promise<MediaStream> {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new DOMException(
      "Camera requires a secure context.",
      "SecurityError",
    );
  }

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
