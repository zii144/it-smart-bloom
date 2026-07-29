/**
 * Booth camera open helpers.
 *
 * Keep constraints minimal: the booth crops to a square after capture, so
 * asking for exact sizes only creates OverconstrainedError paths. Chrome also
 * reports OverconstrainedError("Invalid constraint") when no camera is
 * actually available, so failures are matched by `name`, not by instanceof —
 * OverconstrainedError is not a DOMException in Safari or Firefox.
 */

export const CAMERA_CONSTRAINT_ATTEMPTS: MediaStreamConstraints[] = [
  { video: { facingMode: { ideal: "user" } }, audio: false },
  { video: true, audio: false },
];

const FATAL_ERROR_NAMES = new Set([
  "NotAllowedError",
  "PermissionDeniedError",
  "SecurityError",
]);

function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

function failedConstraint(error: unknown): string {
  if (typeof error === "object" && error !== null && "constraint" in error) {
    const constraint = (error as { constraint?: unknown }).constraint;
    if (typeof constraint === "string") return constraint;
  }
  return "";
}

export function describeCameraError(error: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "相機需要 HTTPS（或本機 localhost）。手機請用正式網址，不要用 http://192.168… 開啟。";
  }

  switch (errorName(error)) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "相機權限遭到封鎖。請點網址列左側的鎖頭／網站設定，允許相機後重新整理再試。";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError": {
      const constraint = failedConstraint(error);
      const detail = constraint ? `（${constraint}）` : "";
      return `瀏覽器目前取不到相機${detail}。請到系統「隱私權與安全性 → 相機」允許此瀏覽器，完全結束瀏覽器後重開再試。`;
    }
    case "NotReadableError":
    case "TrackStartError":
      return "相機正被其他應用程式使用，請關閉後再試一次。";
    case "SecurityError":
      return "瀏覽器基於安全理由拒絕開啟相機，請使用 HTTPS 開啟本頁。";
    default:
      break;
  }

  const name = errorName(error);
  return name
    ? `無法開啟相機（${name}），請再試一次。`
    : "無法開啟相機，請再試一次。";
}

export const CAMERA_DEVICE_PREF_KEY = "bloom.camera.deviceId";

/**
 * `facingMode: "user"` cannot disambiguate desktop cameras, so a Mac paired
 * with an iPhone often hands the booth the Continuity camera (which streams a
 * blank frame while the phone sits on a desk). Labels are only populated once
 * permission is granted, so scoring runs after the first successful open.
 */
const BUILT_IN_LABEL =
  /facetime|built-?in|integrated|internal|webcam|內建|前置|front/i;
const AVOID_LABEL =
  /continuity|desk view|virtual|obs|snap|manycam|epoccam|droidcam|iriun|ndi|back|rear|後置|environment/i;

export function pickPreferredCamera(devices: MediaDeviceInfo[]): string | null {
  let best: { deviceId: string; score: number } | null = null;

  for (const device of devices) {
    if (device.kind !== "videoinput" || !device.label || !device.deviceId) {
      continue;
    }

    let score = 0;
    if (BUILT_IN_LABEL.test(device.label)) score += 3;
    if (AVOID_LABEL.test(device.label)) score -= 3;

    if (score > 0 && (!best || score > best.score)) {
      best = { deviceId: device.deviceId, score };
    }
  }

  return best?.deviceId ?? null;
}

export function readCameraPreference(): string | null {
  try {
    return window.localStorage.getItem(CAMERA_DEVICE_PREF_KEY) || null;
  } catch {
    return null;
  }
}

export function writeCameraPreference(deviceId: string | null) {
  try {
    if (deviceId) {
      window.localStorage.setItem(CAMERA_DEVICE_PREF_KEY, deviceId);
    } else {
      window.localStorage.removeItem(CAMERA_DEVICE_PREF_KEY);
    }
  } catch {
    // private mode / blocked storage
  }
}

export function activeDeviceId(stream: MediaStream): string | null {
  const track = stream.getVideoTracks?.()[0];
  return track?.getSettings?.().deviceId ?? null;
}

type CameraAccessDeps = {
  getUserMedia?: MediaDevices["getUserMedia"];
  enumerateDevices?: MediaDevices["enumerateDevices"];
  isSecureContext?: boolean;
  deviceId?: string | null;
};

function deviceConstraints(deviceId: string): MediaStreamConstraints {
  return { video: { deviceId: { exact: deviceId } }, audio: false };
}

/** Swap a Continuity/virtual camera for the built-in one, if we can spot it. */
async function preferBuiltInCamera(
  stream: MediaStream,
  getUserMedia: MediaDevices["getUserMedia"],
  enumerateDevices: MediaDevices["enumerateDevices"],
): Promise<MediaStream> {
  try {
    const cameras = (await enumerateDevices()).filter(
      (device) => device.kind === "videoinput",
    );
    if (cameras.length < 2) return stream;

    const preferred = pickPreferredCamera(cameras);
    if (!preferred || preferred === activeDeviceId(stream)) return stream;

    const next = await getUserMedia(deviceConstraints(preferred));
    stream.getTracks().forEach((track) => track.stop());
    return next;
  } catch {
    // Keep whatever the browser already gave us.
    return stream;
  }
}

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
  const enumerateDevices =
    deps.enumerateDevices ??
    (typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.enumerateDevices === "function"
      ? navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices)
      : null);

  const chosen =
    deps.deviceId ?? (typeof window !== "undefined" ? readCameraPreference() : null);
  const attempts = chosen
    ? [deviceConstraints(chosen), ...CAMERA_CONSTRAINT_ATTEMPTS]
    : CAMERA_CONSTRAINT_ATTEMPTS;

  let lastError: unknown = new DOMException(
    "No camera constraints succeeded.",
    "NotFoundError",
  );

  for (const constraints of attempts) {
    let stream: MediaStream;
    try {
      stream = await getUserMedia(constraints);
    } catch (error) {
      lastError = error;
      if (FATAL_ERROR_NAMES.has(errorName(error))) {
        throw error;
      }
      continue;
    }

    if (chosen || !enumerateDevices) return stream;
    return preferBuiltInCamera(stream, getUserMedia, enumerateDevices);
  }

  throw lastError;
}
