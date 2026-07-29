/**
 * Simplest constraints first — desktop webcams often reject `facingMode`
 * with NotFoundError even when a camera exists, which skipped the prompt.
 */
export const CAMERA_CONSTRAINT_ATTEMPTS: MediaStreamConstraints[] = [
  { video: true, audio: false },
  {
    video: { facingMode: { ideal: "user" } },
    audio: false,
  },
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
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "相機權限遭到封鎖。請點網址列左側的鎖頭／網站設定，允許相機後再試一次。";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "找不到可用的相機。請確認相機已接上，並在系統「隱私權與安全性 → 相機」允許此瀏覽器存取。";
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

type CameraAccessDeps = {
  getUserMedia?: MediaDevices["getUserMedia"];
  enumerateDevices?: MediaDevices["enumerateDevices"];
};

function defaultGetUserMedia() {
  return navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
}

function defaultEnumerateDevices() {
  return navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
}

async function constraintAttemptsFromDevices(
  enumerateDevices: MediaDevices["enumerateDevices"],
): Promise<MediaStreamConstraints[]> {
  try {
    const devices = await enumerateDevices();
    return devices
      .filter((device) => device.kind === "videoinput" && device.deviceId)
      .map((device) => ({
        video: { deviceId: { exact: device.deviceId } },
        audio: false,
      }));
  } catch {
    return [];
  }
}

export async function requestUserCamera(
  deps: CameraAccessDeps = {},
): Promise<MediaStream> {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new DOMException(
      "Camera requires a secure context.",
      "SecurityError",
    );
  }

  const getUserMedia = deps.getUserMedia ?? defaultGetUserMedia();
  const enumerateDevices = deps.enumerateDevices ?? defaultEnumerateDevices();

  const attempts = [
    ...CAMERA_CONSTRAINT_ATTEMPTS,
    ...(await constraintAttemptsFromDevices(enumerateDevices)),
  ];

  let lastError: unknown = new DOMException(
    "No camera constraints succeeded.",
    "NotFoundError",
  );

  for (const constraints of attempts) {
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
