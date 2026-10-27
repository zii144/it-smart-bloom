"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  clampCrop,
  cropImageLayout,
  INITIAL_CROP,
  MAX_CROP_ZOOM,
  MIN_CROP_ZOOM,
  panCrop,
  zoomCrop,
  type PhotoCrop,
  type PhotoSize,
} from "@/lib/photo-crop";

const KEY_PAN_PX = 12;
const KEY_ZOOM_STEP = 1.12;
const WHEEL_ZOOM_RATE = 0.0015;

type Point = { x: number; y: number };

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** A screen point relative to the frame's centre. */
function fromCentre(point: Point, box: DOMRect): Point {
  return { x: point.x - (box.left + box.width / 2), y: point.y - (box.top + box.height / 2) };
}

/**
 * A square frame the guest moves and zooms their photo in: drag with a
 * finger or mouse, pinch or scroll to zoom, or use the slider and arrow keys.
 * The parent owns the crop and turns it into the photo that is sent.
 */
export function PhotoCropper({
  src,
  alt,
  crop,
  onCropChange,
}: {
  src: string;
  alt: string;
  crop: PhotoCrop;
  onCropChange: (crop: PhotoCrop) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<PhotoSize | null>(null);
  const pointers = useRef(new Map<number, Point>());
  // Pointer and wheel events can arrive several times per frame, before React
  // re-renders with the new crop, so each one builds on the latest value.
  const latest = useRef({ crop, size, onCropChange });
  useEffect(() => {
    latest.current = { crop, size, onCropChange };
  }, [crop, size, onCropChange]);

  function apply(next: PhotoCrop) {
    latest.current.crop = next;
    latest.current.onCropChange(next);
  }

  function frameBox() {
    return frameRef.current?.getBoundingClientRect() ?? null;
  }

  // Scrolling zooms instead of scrolling the page, so the listener cannot be
  // passive (React's onWheel is).
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    function onWheel(event: WheelEvent) {
      const current = latest.current;
      const box = frameRef.current?.getBoundingClientRect();
      if (!current.size || !box) return;
      event.preventDefault();
      const nextZoom = current.crop.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE);
      const focus = fromCentre({ x: event.clientX, y: event.clientY }, box);
      const next = zoomCrop(current.crop, nextZoom, box.width, current.size, focus);
      current.crop = next;
      current.onCropChange(next);
    }
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    const { crop: current, size: photo } = latest.current;
    const box = frameBox();
    if (!previous || !photo || !box) return;
    const next = { x: event.clientX, y: event.clientY };

    if (pointers.current.size === 1) {
      pointers.current.set(event.pointerId, next);
      apply(panCrop(current, next.x - previous.x, next.y - previous.y, box.width, photo));
      return;
    }

    // Two fingers: zoom by how far they spread, about their midpoint, and
    // follow the midpoint as it moves.
    const otherEntry = [...pointers.current].find(([id]) => id !== event.pointerId);
    if (!otherEntry) return;
    const other = otherEntry[1];
    pointers.current.set(event.pointerId, next);
    const before = distance(previous, other);
    if (before < 1) return;
    const fromMid = midpoint(previous, other);
    const toMid = midpoint(next, other);
    const zoomed = zoomCrop(
      current,
      current.zoom * (distance(next, other) / before),
      box.width,
      photo,
      fromCentre(fromMid, box),
    );
    apply(panCrop(zoomed, toMid.x - fromMid.x, toMid.y - fromMid.y, box.width, photo));
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const box = frameBox();
    if (!size || !box) return;
    const moves: Record<string, Point> = {
      ArrowLeft: { x: -KEY_PAN_PX, y: 0 },
      ArrowRight: { x: KEY_PAN_PX, y: 0 },
      ArrowUp: { x: 0, y: -KEY_PAN_PX },
      ArrowDown: { x: 0, y: KEY_PAN_PX },
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      apply(panCrop(crop, move.x, move.y, box.width, size));
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      apply(zoomCrop(crop, crop.zoom * KEY_ZOOM_STEP, box.width, size));
    } else if (event.key === "-") {
      event.preventDefault();
      apply(zoomCrop(crop, crop.zoom / KEY_ZOOM_STEP, box.width, size));
    }
  }

  const layout = size ? cropImageLayout(crop, size) : null;

  return (
    <div className="photo-cropper">
      <div
        ref={frameRef}
        className="review-image photo-cropper-frame"
        tabIndex={0}
        aria-label="照片取景框：拖曳移動照片，雙指或滾輪縮放；也可用方向鍵移動、加減鍵縮放"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
      >
        {/* A plain img: it is moved by percentages, which next/image's fill would fight. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          className={layout ? "is-placed" : undefined}
          style={
            layout
              ? {
                  width: `${layout.width}%`,
                  height: `${layout.height}%`,
                  left: `${layout.left}%`,
                  top: `${layout.top}%`,
                }
              : undefined
          }
          onLoad={(event) => {
            const photo = {
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            };
            if (!photo.width || !photo.height) return;
            setSize(photo);
            onCropChange(clampCrop(latest.current.crop, photo));
          }}
        />
        <span className="photo-cropper-guide" aria-hidden="true" />
      </div>

      <div className="photo-cropper-controls">
        <span aria-hidden="true">－</span>
        <input
          type="range"
          min={MIN_CROP_ZOOM}
          max={MAX_CROP_ZOOM}
          step={0.01}
          value={crop.zoom}
          aria-label="縮放照片"
          disabled={!size}
          onChange={(event) => {
            const box = frameBox();
            if (!size || !box) return;
            apply(zoomCrop(crop, Number(event.target.value), box.width, size));
          }}
        />
        <span aria-hidden="true">＋</span>
        <button
          type="button"
          className="text-button photo-cropper-reset"
          disabled={!size}
          onClick={() => size && apply(clampCrop(INITIAL_CROP, size))}
        >
          重設
        </button>
      </div>
    </div>
  );
}
