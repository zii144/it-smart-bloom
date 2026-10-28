// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckInCard } from "@/components/check-in-card";
import { SuccessCard, type SuccessView } from "@/components/success-card";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={String(props.src)} alt={String(props.alt ?? "")} />
  ),
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const RUNDOWN =
  "https://drive.google.com/drive/folders/10e-ui7G2bgnJMb_hZSzl7Ju0ziQeahwK?usp=drive_link";

const READY: SuccessView = {
  kind: "ready",
  guestName: "王小美",
  rundownUrl: RUNDOWN,
  rundownQrDataUrl: "data:image/png;base64,AAAA",
};

describe("SuccessCard", () => {
  it("confirms the photo and points the QR and the link at the rundown", () => {
    const { container, getByText } = render(<SuccessCard view={READY} />);

    expect(container.querySelector(".celebration-name")?.textContent).toBe(
      "王小美",
    );
    expect(getByText("照片已經收到")).toBeTruthy();
    expect(getByText("活動當天報到後，即可領取您的似顏繪")).toBeTruthy();
    expect(
      container
        .querySelector('img[alt="活動流程 QR Code"]')
        ?.getAttribute("src"),
    ).toBe(READY.rundownQrDataUrl);
    expect(getByText("或按此開啟活動流程").getAttribute("href")).toBe(RUNDOWN);
  });

  it("shows the event time with check-in opening, and no seat (QA)", () => {
    const { container } = render(<SuccessCard view={READY} />);
    expect(container.textContent).toContain("14:00–15:3013:10分開始報到");
    expect(container.textContent).not.toContain("座位");
  });

  it("never hands out the portrait or its links", () => {
    const { container } = render(<SuccessCard view={READY} />);

    const hrefs = [...container.querySelectorAll("a")].map((link) =>
      link.getAttribute("href"),
    );
    expect(
      hrefs.some((href) => href?.includes("/s/") || href?.includes("line.me")),
    ).toBe(false);
    expect(container.textContent).not.toMatch(/作品已完成|正在為您作畫|LINE/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a floral seal, not a character", () => {
    const { container } = render(<SuccessCard view={READY} />);
    const seal = container.querySelector(".celebration-seal")!;
    expect(seal.querySelector("svg")).toBeTruthy();
    expect(seal.textContent).toBe("");
    expect(container.textContent).not.toContain("賀");
  });

  it("still works without a roster name", () => {
    const { container } = render(
      <SuccessCard view={{ ...READY, guestName: null }} />,
    );
    expect(container.querySelector(".celebration-name")).toBeNull();
    expect(container.textContent).toContain("照片已經收到");
  });

  it("explains an expired link", () => {
    const { container } = render(<SuccessCard view={{ kind: "expired" }} />);
    expect(container.textContent).toContain("這個連結已經過期");
  });
});

function fillCheckIn(
  container: HTMLElement,
  name = "王小美",
  phone = "0911-111-111",
) {
  fireEvent.change(container.querySelector("#check-in-name")!, {
    target: { value: name },
  });
  fireEvent.change(container.querySelector("#check-in-phone")!, {
    target: { value: phone },
  });
  fireEvent.submit(container.querySelector("form")!);
}

describe("CheckInCard", () => {
  it("shows a friendly closed card", () => {
    const { container } = render(<CheckInCard availability="closed" />);
    expect(container.textContent).toContain("報到尚未開放");
    expect(container.querySelector("form")).toBeNull();
  });

  it("celebrates a successful check-in with the seat", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        name: "王小美",
        seat: "A1",
        checkedInAt: "2026-11-10T06:02:00.000Z",
        alreadyCheckedIn: false,
        portrait: { status: null, url: null },
      }),
    );
    const { container, findByText } = render(
      <CheckInCard availability="open" />,
    );

    fillCheckIn(container);

    expect(await findByText("報到成功，歡迎蒞臨")).toBeTruthy();
    expect(
      container.querySelector(".celebration-ticket strong")?.textContent,
    ).toBe("A1");
    expect(container.textContent).toContain("抵達時間 14:02");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/check-in",
      expect.objectContaining({
        body: JSON.stringify({ name: "王小美", phone: "0911111111" }),
      }),
    );
  });

  it("shows the original time for a repeat check-in", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        name: "王小美",
        seat: "",
        checkedInAt: "2026-11-10T05:45:00.000Z",
        alreadyCheckedIn: true,
        portrait: { status: null, url: null },
      }),
    );
    const { container, findByText } = render(
      <CheckInCard availability="open" />,
    );
    fillCheckIn(container);

    expect(await findByText("您已完成報到")).toBeTruthy();
    expect(container.textContent).toContain("報到時間 13:45");
    expect(container.querySelector(".celebration-ticket")).toBeNull();
  });

  it("keeps a guest who is not on the roster on the form", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "找不到你的報名資料" }, { status: 403 }),
    );
    const { container, findByRole } = render(
      <CheckInCard availability="open" />,
    );
    fillCheckIn(container);

    expect((await findByRole("alert")).textContent).toContain(
      "找不到你的報名資料",
    );
    expect(container.querySelector("#check-in-name")).toBeTruthy();
  });

  it("switches to the closed card if an admin closes check-in meanwhile", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "報到尚未開放", closed: true }, { status: 403 }),
    );
    const { container } = render(<CheckInCard availability="open" />);
    fillCheckIn(container);

    await waitFor(() => expect(container.querySelector("form")).toBeNull());
    expect(container.textContent).toContain("報到尚未開放");
  });

  it("hands over the finished portrait after check-in", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        name: "王小美",
        seat: "A1",
        checkedInAt: "2026-11-10T06:02:00.000Z",
        alreadyCheckedIn: false,
        portrait: { status: "complete", url: "/api/check-in/portrait/tok" },
      }),
    );
    const { container, findByAltText, getByText } = render(
      <CheckInCard availability="open" />,
    );
    fillCheckIn(container);

    expect((await findByAltText("您的路老師似顏繪")).getAttribute("src")).toBe(
      "/api/check-in/portrait/tok",
    );
    const save = getByText("儲存作品").closest("a")!;
    expect(save.getAttribute("href")).toBe(
      "/api/check-in/portrait/tok?download=1",
    );
    expect(save.hasAttribute("download")).toBe(true);
    expect(container.querySelector(".celebration-seal")?.textContent).toBe("");
  });

  it("offers real avatar replacement at check-in without requiring a fresh creation link", async () => {
    process.env.NEXT_PUBLIC_RT_AVATAR_ENABLED = "true";
    process.env.NEXT_PUBLIC_RT_FIREBASE_API_KEY = "public-key";
    process.env.NEXT_PUBLIC_RT_FIREBASE_AUTH_DOMAIN = "rt-test.firebaseapp.com";
    process.env.NEXT_PUBLIC_RT_FIREBASE_PROJECT_ID = "rt-test";
    process.env.NEXT_PUBLIC_RT_SET_AVATAR_URL =
      "https://rt.example/bloomSetAvatar";
    fetchMock.mockResolvedValue(
      Response.json({
        name: "測試來賓",
        seat: "A1",
        checkedInAt: "2026-11-10T06:02:00.000Z",
        alreadyCheckedIn: false,
        portrait: {
          status: "complete",
          url: `/api/check-in/portrait/${"t".repeat(43)}`,
        },
      }),
    );
    const { container, findByAltText, getByRole, queryByRole, getByLabelText } =
      render(<CheckInCard availability="open" />);
    fillCheckIn(container);
    await findByAltText("您的路老師似顏繪");
    expect(queryByRole("dialog")).toBeNull();
    expect(getByRole("link", { name: /儲存作品/ })).toBeTruthy();
    const action = getByRole("button", { name: "一鍵替換成路老師系統大頭貼" });
    action.focus();
    fireEvent.click(action);
    const modal = getByRole("dialog");
    expect(modal.closest(".celebration-card")).toBeNull();
    expect(document.activeElement).toBe(getByLabelText(/電子郵件/));
    fireEvent.change(getByLabelText(/密碼/), {
      target: { value: "do-not-keep" },
    });
    fireEvent.click(getByRole("button", { name: "取消" }));
    expect(queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(action);
    fireEvent.click(action);
    expect((getByLabelText(/密碼/) as HTMLInputElement).value).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lets a guest look again while the portrait is still being painted", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({
          name: "王小美",
          seat: "A1",
          checkedInAt: "2026-11-10T06:02:00.000Z",
          alreadyCheckedIn: false,
          portrait: { status: "generating", url: null },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          name: "王小美",
          seat: "A1",
          checkedInAt: "2026-11-10T06:02:00.000Z",
          alreadyCheckedIn: true,
          portrait: { status: "complete", url: "/api/check-in/portrait/tok" },
        }),
      );
    const { container, findByText, findByAltText } = render(
      <CheckInCard availability="open" />,
    );
    fillCheckIn(container);

    fireEvent.click(await findByText("再看一次"));

    expect(await findByAltText("您的路老師似顏繪")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ name: "王小美", phone: "0911111111" }),
    });
  });

  it("offers the booth to a guest who has no portrait yet", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        name: "王小美",
        seat: "",
        checkedInAt: "2026-11-10T06:02:00.000Z",
        alreadyCheckedIn: false,
        portrait: { status: null, url: null },
      }),
    );
    const { container, findByText } = render(
      <CheckInCard availability="open" />,
    );
    fillCheckIn(container);

    expect(await findByText("您還沒有建立似顏繪，歡迎現場體驗。")).toBeTruthy();
    expect(container.querySelector('a[href="/"]')?.textContent).toContain(
      "體驗路老師似顏繪",
    );
    expect(container.textContent).not.toContain("儲存作品");
  });

  it("validates before calling the server", () => {
    const { container, getByRole } = render(
      <CheckInCard availability="open" />,
    );
    fillCheckIn(container, "王小美", "12345");

    expect(getByRole("alert").textContent).toContain("09 開頭");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
