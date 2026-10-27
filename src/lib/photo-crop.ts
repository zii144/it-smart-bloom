/**
 * Square crop of an uploaded photo, chosen by dragging and zooming it inside
 * a fixed frame (like setting a LINE profile picture).
 *
 * A crop is the point of the photo under the frame's centre (`cx`, `cy`, as
 * fractions of its width and height) plus a zoom. Zoom 1 fits the photo's
 * short side to the frame, so the frame is always covered: there is never an
 * empty edge to send to the painter.
 */
export type PhotoCrop = { zoom: number; cx: number; cy: number };
export type PhotoSize = { width: number; height: number };

export const MIN_CROP_ZOOM = 1;
export const MAX_CROP_ZOOM = 4;
/** Same ceiling as a camera capture. */
export const MAX_CROP_OUTPUT = 1280;

export const INITIAL_CROP: PhotoCrop = { zoom: 1, cx: 0.5, cy: 0.5 };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Half of the frame, as a fraction of the photo's width and height. */
function halfFrame(zoom: number, size: PhotoSize) {
  const side = Math.min(size.width, size.height) / zoom;
  return { x: side / (2 * size.width), y: side / (2 * size.height) };
}

/** Keeps the zoom in range and the photo covering the whole frame. */
export function clampCrop(crop: PhotoCrop, size: PhotoSize): PhotoCrop {
  const zoom = clamp(
    Number.isFinite(crop.zoom) ? crop.zoom : MIN_CROP_ZOOM,
    MIN_CROP_ZOOM,
    MAX_CROP_ZOOM,
  );
  const half = halfFrame(zoom, size);
  return {
    zoom,
    cx: clamp(Number.isFinite(crop.cx) ? crop.cx : 0.5, half.x, 1 - half.x),
    cy: clamp(Number.isFinite(crop.cy) ? crop.cy : 0.5, half.y, 1 - half.y),
  };
}

/** The photo's drawn size, as a multiple of the frame's side. */
function drawnScale(zoom: number, size: PhotoSize) {
  const short = Math.min(size.width, size.height);
  return { x: (zoom * size.width) / short, y: (zoom * size.height) / short };
}

/**
 * Moves the photo with the finger: dragging by (dx, dy) screen pixels in a
 * frame `frameSide` pixels wide.
 */
export function panCrop(
  crop: PhotoCrop,
  dx: number,
  dy: number,
  frameSide: number,
  size: PhotoSize,
): PhotoCrop {
  if (!(frameSide > 0)) return crop;
  const scale = drawnScale(crop.zoom, size);
  return clampCrop(
    {
      zoom: crop.zoom,
      cx: crop.cx - dx / (frameSide * scale.x),
      cy: crop.cy - dy / (frameSide * scale.y),
    },
    size,
  );
}

/**
 * Zooms while keeping the photo point under `focus` still. `focus` is in
 * frame pixels from the frame's centre (a pinch midpoint or the cursor);
 * omit it to zoom about the centre.
 */
export function zoomCrop(
  crop: PhotoCrop,
  nextZoom: number,
  frameSide: number,
  size: PhotoSize,
  focus: { x: number; y: number } = { x: 0, y: 0 },
): PhotoCrop {
  const zoom = clamp(nextZoom, MIN_CROP_ZOOM, MAX_CROP_ZOOM);
  if (!(frameSide > 0)) return clampCrop({ ...crop, zoom }, size);
  const before = drawnScale(crop.zoom, size);
  const after = drawnScale(zoom, size);
  const pointX = crop.cx + focus.x / (frameSide * before.x);
  const pointY = crop.cy + focus.y / (frameSide * before.y);
  return clampCrop(
    {
      zoom,
      cx: pointX - focus.x / (frameSide * after.x),
      cy: pointY - focus.y / (frameSide * after.y),
    },
    size,
  );
}

/**
 * Where to draw the photo inside the frame, in percent of the frame's side,
 * so the preview needs no measuring and survives resizes.
 */
export function cropImageLayout(crop: PhotoCrop, size: PhotoSize) {
  const { zoom, cx, cy } = clampCrop(crop, size);
  const scale = drawnScale(zoom, size);
  return {
    width: scale.x * 100,
    height: scale.y * 100,
    left: 50 - cx * scale.x * 100,
    top: 50 - cy * scale.y * 100,
  };
}

/** The square of the original photo, in its own pixels, that will be sent. */
export function cropSourceRect(crop: PhotoCrop, size: PhotoSize) {
  const { zoom, cx, cy } = clampCrop(crop, size);
  const side = Math.min(size.width, size.height) / zoom;
  return {
    x: cx * size.width - side / 2,
    y: cy * size.height - side / 2,
    side,
  };
}

function loadImage(src: string, timeoutMs: number) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(
      () => reject(new Error("photo took too long to load")),
      timeoutMs,
    );
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("photo could not be read"));
    };
    image.src = src;
  });
}

/**
 * Draws the chosen square of the photo into a JPEG. Browsers apply the
 * photo's EXIF rotation both to the preview and to this drawing, so what the
 * guest framed is what is sent.
 */
export async function renderCroppedPhoto(
  src: string,
  crop: PhotoCrop,
  { timeoutMs = 15_000 }: { timeoutMs?: number } = {},
): Promise<Blob> {
  const image = await loadImage(src, timeoutMs);
  const size = { width: image.naturalWidth, height: image.naturalHeight };
  if (!size.width || !size.height) throw new Error("photo has no size");

  const rect = cropSourceRect(crop, size);
  const output = Math.max(1, Math.round(Math.min(rect.side, MAX_CROP_OUTPUT)));
  const canvas = document.createElement("canvas");
  canvas.width = output;
  canvas.height = output;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas unavailable");

  // A transparent PNG would turn black as a JPEG; paper-white reads better.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, output, output);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, rect.x, rect.y, rect.side, rect.side, 0, 0, output, output);

  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("could not encode photo"))),
      "image/jpeg",
      0.9,
    ),
  );
}
