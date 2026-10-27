// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampCrop,
  cropImageLayout,
  cropSourceRect,
  INITIAL_CROP,
  MAX_CROP_ZOOM,
  panCrop,
  renderCroppedPhoto,
  zoomCrop,
  type PhotoCrop,
  type PhotoSize,
} from "@/lib/photo-crop";

const LANDSCAPE: PhotoSize = { width: 4000, height: 3000 };
const PORTRAIT: PhotoSize = { width: 3000, height: 4000 };
const FRAME = 400;

/** The photo point (fractions) drawn at a frame point, from the crop maths. */
function photoPointAt(crop: PhotoCrop, size: PhotoSize, focus: { x: number; y: number }) {
  const layout = cropImageLayout(crop, size);
  const frameX = FRAME / 2 + focus.x;
  const frameY = FRAME / 2 + focus.y;
  return {
    x: (frameX - (layout.left / 100) * FRAME) / ((layout.width / 100) * FRAME),
    y: (frameY - (layout.top / 100) * FRAME) / ((layout.height / 100) * FRAME),
  };
}

describe("clampCrop", () => {
  it("keeps the frame covered by the photo", () => {
    // At zoom 1 a 4:3 photo fills the frame top to bottom, so it can only
    // slide sideways, and only until its edge reaches the frame's edge.
    expect(clampCrop({ zoom: 1, cx: 0, cy: 0 }, LANDSCAPE)).toEqual({
      zoom: 1,
      cx: 0.375,
      cy: 0.5,
    });
    expect(clampCrop({ zoom: 1, cx: 1, cy: 1 }, PORTRAIT)).toEqual({
      zoom: 1,
      cx: 0.5,
      cy: 0.625,
    });
  });

  it("keeps the zoom between fitting the photo and four times that", () => {
    expect(clampCrop({ zoom: 0.2, cx: 0.5, cy: 0.5 }, LANDSCAPE).zoom).toBe(1);
    expect(clampCrop({ zoom: 99, cx: 0.5, cy: 0.5 }, LANDSCAPE).zoom).toBe(MAX_CROP_ZOOM);
  });

  it("recovers from values that are not numbers", () => {
    expect(clampCrop({ zoom: Number.NaN, cx: Number.NaN, cy: Infinity }, LANDSCAPE)).toEqual(
      INITIAL_CROP,
    );
  });
});

describe("panCrop", () => {
  it("moves the photo with the finger", () => {
    // Dragging right shows more of the photo's left side.
    const dragged = panCrop(INITIAL_CROP, 40, 0, FRAME, LANDSCAPE);
    expect(dragged.cx).toBeCloseTo(0.5 - 40 / (FRAME * (4 / 3)));
    expect(dragged.cy).toBe(0.5);
  });

  it("stops at the photo's edge", () => {
    expect(panCrop(INITIAL_CROP, 10_000, 10_000, FRAME, LANDSCAPE)).toEqual({
      zoom: 1,
      cx: 0.375,
      cy: 0.5,
    });
  });

  it("moves less across the photo when zoomed in", () => {
    const zoomed = { zoom: 2, cx: 0.5, cy: 0.5 };
    const moved = panCrop(zoomed, 0, -40, FRAME, PORTRAIT);
    expect(moved.cy - 0.5).toBeCloseTo(40 / (FRAME * 2 * (4 / 3)));
  });

  it("ignores a frame that has not been laid out", () => {
    expect(panCrop(INITIAL_CROP, 40, 40, 0, LANDSCAPE)).toBe(INITIAL_CROP);
  });
});

describe("zoomCrop", () => {
  it("keeps the point under the fingers still", () => {
    const start = { zoom: 1.4, cx: 0.45, cy: 0.52 };
    const focus = { x: 60, y: -30 };
    const before = photoPointAt(start, LANDSCAPE, focus);
    const zoomed = zoomCrop(start, 2.1, FRAME, LANDSCAPE, focus);
    const after = photoPointAt(zoomed, LANDSCAPE, focus);

    expect(zoomed.zoom).toBe(2.1);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("zooms about the centre by default and stays in range", () => {
    expect(zoomCrop(INITIAL_CROP, 2, FRAME, PORTRAIT)).toEqual({ zoom: 2, cx: 0.5, cy: 0.5 });
    expect(zoomCrop(INITIAL_CROP, 10, FRAME, PORTRAIT).zoom).toBe(MAX_CROP_ZOOM);
  });

  it("pulls the photo back over the frame when zooming out near an edge", () => {
    const nearEdge = { zoom: 3, cx: 0.2, cy: 0.5 };
    expect(zoomCrop(nearEdge, 1, FRAME, LANDSCAPE)).toEqual({ zoom: 1, cx: 0.375, cy: 0.5 });
  });
});

describe("cropSourceRect", () => {
  it("is the centred square of the short side at first", () => {
    expect(cropSourceRect(INITIAL_CROP, LANDSCAPE)).toEqual({ x: 500, y: 0, side: 3000 });
    expect(cropSourceRect(INITIAL_CROP, PORTRAIT)).toEqual({ x: 0, y: 500, side: 3000 });
  });

  it("shrinks with the zoom around the chosen point", () => {
    expect(cropSourceRect({ zoom: 2, cx: 0.5, cy: 0.5 }, LANDSCAPE)).toEqual({
      x: 1250,
      y: 750,
      side: 1500,
    });
  });

  it("matches what the frame shows", () => {
    const crop = { zoom: 1.7, cx: 0.41, cy: 0.58 };
    const layout = cropImageLayout(crop, PORTRAIT);
    const rect = cropSourceRect(crop, PORTRAIT);
    // The frame's top-left corner, in photo pixels…
    expect((-layout.left / layout.width) * PORTRAIT.width).toBeCloseTo(rect.x);
    expect((-layout.top / layout.height) * PORTRAIT.height).toBeCloseTo(rect.y);
    // …and its side.
    expect((100 / layout.width) * PORTRAIT.width).toBeCloseTo(rect.side);
  });
});

describe("renderCroppedPhoto", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function stubImage(size: PhotoSize | "error" | "never") {
    class FakeImage {
      naturalWidth = 0;
      naturalHeight = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        if (size === "never") return;
        queueMicrotask(() => {
          if (size === "error") return this.onerror?.();
          this.naturalWidth = size.width;
          this.naturalHeight = size.height;
          this.onload?.();
        });
      }
    }
    vi.stubGlobal("Image", FakeImage);
  }

  function stubCanvas(blob: Blob | null = new Blob(["jpeg"], { type: "image/jpeg" })) {
    const context = {
      fillStyle: "",
      imageSmoothingQuality: "low",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: (value: Blob | null) => void, type: string, quality: number) => {
        void type;
        void quality;
        callback(blob);
      }),
    };
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) =>
      tag === "canvas" ? (canvas as unknown as HTMLCanvasElement) : createElement(tag),
    );
    return { canvas, context };
  }

  it("draws the framed square, at most 1280px, as a JPEG", async () => {
    stubImage(LANDSCAPE);
    const { canvas, context } = stubCanvas();

    const blob = await renderCroppedPhoto("blob:photo", INITIAL_CROP);

    expect(blob.type).toBe("image/jpeg");
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(1280);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1280, 1280);
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      500,
      0,
      3000,
      3000,
      0,
      0,
      1280,
      1280,
    );
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.9);
  });

  it("keeps a small crop at its own size instead of enlarging it", async () => {
    stubImage({ width: 800, height: 600 });
    const { canvas } = stubCanvas();

    await renderCroppedPhoto("blob:photo", { zoom: 2, cx: 0.5, cy: 0.5 });

    expect(canvas.width).toBe(300);
  });

  it("fails when the photo cannot be read", async () => {
    stubImage("error");
    stubCanvas();
    await expect(renderCroppedPhoto("blob:photo", INITIAL_CROP)).rejects.toThrow(
      "could not be read",
    );
  });

  it("gives up on a photo that never loads", async () => {
    vi.useFakeTimers();
    stubImage("never");
    stubCanvas();
    const pending = renderCroppedPhoto("blob:photo", INITIAL_CROP, { timeoutMs: 1000 });
    const assertion = expect(pending).rejects.toThrow("too long");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("fails when the browser cannot encode the JPEG", async () => {
    stubImage(LANDSCAPE);
    stubCanvas(null);
    await expect(renderCroppedPhoto("blob:photo", INITIAL_CROP)).rejects.toThrow("encode");
  });
});
