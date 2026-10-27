// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PhotoCropper } from "@/components/photo-cropper";
import { INITIAL_CROP, type PhotoCrop } from "@/lib/photo-crop";

const FRAME = 400;

function Harness({ initial = INITIAL_CROP }: { initial?: PhotoCrop }) {
  const [crop, setCrop] = useState(initial);
  return (
    <>
      <PhotoCropper src="blob:photo" alt="你選擇的人像照片" crop={crop} onCropChange={setCrop} />
      <output data-crop={JSON.stringify(crop)} />
    </>
  );
}

function readCrop(container: HTMLElement): PhotoCrop {
  return JSON.parse(container.querySelector("output")!.getAttribute("data-crop")!);
}

/** jsdom neither decodes images nor lays out: fake both. */
function loadPhoto(container: HTMLElement, width = 4000, height = 3000) {
  const frame = container.querySelector<HTMLElement>(".photo-cropper-frame")!;
  frame.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: FRAME, height: FRAME, right: FRAME, bottom: FRAME }) as DOMRect;
  const image = frame.querySelector("img")!;
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: height });
  fireEvent.load(image);
  return { frame, image };
}

function pointer(type: "pointerDown" | "pointerMove" | "pointerUp", target: Element, id: number, x: number, y: number) {
  fireEvent[type](target, { pointerId: id, clientX: x, clientY: y, pointerType: "touch", button: 0 });
}

afterEach(cleanup);

describe("PhotoCropper", () => {
  it("places the photo to cover the frame once it has loaded", () => {
    const { container } = render(<Harness />);
    const zoom = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(zoom.disabled).toBe(true);

    const { image } = loadPhoto(container);

    expect(zoom.disabled).toBe(false);
    expect(image.className).toBe("is-placed");
    // 4:3 at zoom 1: as tall as the frame, a third wider, centred.
    expect(image.style.height).toBe("100%");
    expect(parseFloat(image.style.width)).toBeCloseTo(133.33, 1);
    expect(parseFloat(image.style.left)).toBeCloseTo(-16.67, 1);
  });

  it("moves the photo with a drag, and only as far as its edge", () => {
    const { container } = render(<Harness />);
    const { frame } = loadPhoto(container);

    pointer("pointerDown", frame, 1, 200, 200);
    pointer("pointerMove", frame, 1, 240, 200);
    expect(readCrop(container).cx).toBeCloseTo(0.5 - 40 / (FRAME * (4 / 3)));

    pointer("pointerMove", frame, 1, 2000, 200);
    pointer("pointerUp", frame, 1, 2000, 200);
    expect(readCrop(container)).toEqual({ zoom: 1, cx: 0.375, cy: 0.5 });

    // Moving after the finger lifts does nothing.
    pointer("pointerMove", frame, 1, 0, 200);
    expect(readCrop(container).cx).toBe(0.375);
  });

  it("zooms with a two-finger pinch", () => {
    const { container } = render(<Harness />);
    const { frame } = loadPhoto(container);

    pointer("pointerDown", frame, 1, 150, 200);
    pointer("pointerDown", frame, 2, 250, 200);
    pointer("pointerMove", frame, 2, 350, 200);

    // The fingers went from 100px to 200px apart.
    expect(readCrop(container).zoom).toBeCloseTo(2);
  });

  it("can be framed with the keyboard and the slider, and reset", () => {
    const { container } = render(<Harness />);
    const { frame } = loadPhoto(container, 3000, 4000);
    const zoom = container.querySelector<HTMLInputElement>('input[type="range"]')!;

    fireEvent.keyDown(frame, { key: "+" });
    expect(readCrop(container).zoom).toBeCloseTo(1.12);

    // Arrows move the photo like a drag: down shows more of its top.
    fireEvent.keyDown(frame, { key: "ArrowDown" });
    expect(readCrop(container).cy).toBeLessThan(0.5);

    fireEvent.change(zoom, { target: { value: "3" } });
    expect(readCrop(container).zoom).toBe(3);

    const reset = [...container.querySelectorAll("button")].find((b) => b.textContent === "重設")!;
    fireEvent.click(reset);
    expect(readCrop(container)).toEqual(INITIAL_CROP);
  });

  it("zooms with the mouse wheel instead of scrolling the page", () => {
    const { container } = render(<Harness />);
    const { frame } = loadPhoto(container);

    const wheel = new WheelEvent("wheel", { deltaY: -200, clientX: 200, clientY: 200, cancelable: true });
    act(() => {
      frame.dispatchEvent(wheel);
    });

    expect(wheel.defaultPrevented).toBe(true);
    expect(readCrop(container).zoom).toBeGreaterThan(1);
  });
});
