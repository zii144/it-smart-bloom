// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoadTeacherLoginModal } from "@/components/road-teacher-login-modal";

const SESSION_ID = "a".repeat(32);

/** Fetch double for the two endpoints the mock flow touches. */
function mockFetch() {
  const setAvatarCalls: { auth: string | null; body: unknown }[] = [];
  const resultCalls: unknown[] = [];

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/api/dev/set-avatar")) {
        const headers = new Headers(init?.headers);
        setAvatarCalls.push({
          auth: headers.get("Authorization"),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return new Response(JSON.stringify({ ok: true, mock: true }), {
          status: 200,
        });
      }

      if (url.includes("/avatar-result")) {
        resultCalls.push(init?.body ? JSON.parse(String(init.body)) : null);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      return new Response(JSON.stringify({ error: "unexpected" }), {
        status: 500,
      });
    },
  );

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, setAvatarCalls, resultCalls };
}

function fillAndSubmit(email: string, password: string) {
  fireEvent.change(screen.getByLabelText(/電子郵件/), {
    target: { value: email },
  });
  fireEvent.change(screen.getByLabelText(/密碼/), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: "登入並替換" }));
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_RT_MOCK = "true";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RoadTeacherLoginModal", () => {
  it("renders nothing while closed", () => {
    mockFetch();
    render(
      <RoadTeacherLoginModal
        open={false}
        sessionId={SESSION_ID}
        onCancel={() => {}}
        onSuccess={() => {}}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses password-manager-friendly fields", () => {
    mockFetch();
    render(
      <RoadTeacherLoginModal
        open
        sessionId={SESSION_ID}
        onCancel={() => {}}
        onSuccess={() => {}}
      />,
    );

    const email = screen.getByLabelText(/電子郵件/);
    expect(email.getAttribute("type")).toBe("email");
    expect(email.getAttribute("autocomplete")).toBe("username");

    const password = screen.getByLabelText(/密碼/);
    expect(password.getAttribute("type")).toBe("password");
    expect(password.getAttribute("autocomplete")).toBe("current-password");
  });

  it("discloses the mock so nobody mistakes a demo for the real system", () => {
    mockFetch();
    render(
      <RoadTeacherLoginModal
        open
        sessionId={SESSION_ID}
        onCancel={() => {}}
        onSuccess={() => {}}
      />,
    );
    expect(screen.getByText(/開發模擬/)).toBeDefined();
  });

  it("keeps a wrong password inline without closing the sheet", async () => {
    mockFetch();
    const onSuccess = vi.fn();
    render(
      <RoadTeacherLoginModal
        open
        sessionId={SESSION_ID}
        onCancel={() => {}}
        onSuccess={onSuccess}
      />,
    );

    fillAndSubmit("guest@example.com", "wrong");

    expect(await screen.findByText("帳號或密碼不正確。")).toBeDefined();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("runs the full mock flow and reports success upward", async () => {
    const { setAvatarCalls, resultCalls } = mockFetch();
    const onSuccess = vi.fn();
    render(
      <RoadTeacherLoginModal
        open
        sessionId={SESSION_ID}
        onCancel={() => {}}
        onSuccess={onSuccess}
      />,
    );

    fillAndSubmit("guest@example.com", "sunny-day");

    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith({ mock: true }),
    );

    expect(setAvatarCalls).toHaveLength(1);
    expect(setAvatarCalls[0].auth?.startsWith("Bearer mock-rt-idtoken-")).toBe(
      true,
    );
    expect(setAvatarCalls[0].body).toMatchObject({
      sessionId: SESSION_ID,
      portraitUrl: expect.stringContaining(
        `/api/sessions/${SESSION_ID}/image?kind=result`,
      ),
    });

    await waitFor(() => expect(resultCalls).toHaveLength(1));
    expect(resultCalls[0]).toMatchObject({ ok: true });
  });

  it("surfaces an avatar endpoint failure inline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/dev/set-avatar")) {
          return new Response(
            JSON.stringify({ error: "圖片大小不符合限制。" }),
            { status: 413 },
          );
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    const onSuccess = vi.fn();
    render(
      <RoadTeacherLoginModal
        open
        sessionId={SESSION_ID}
        onCancel={() => {}}
        onSuccess={onSuccess}
      />,
    );

    fillAndSubmit("guest@example.com", "sunny-day");

    expect(await screen.findByText("圖片大小不符合限制。")).toBeDefined();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("hands 取消 back to the parent", () => {
    mockFetch();
    const onCancel = vi.fn();
    render(
      <RoadTeacherLoginModal
        open
        sessionId={SESSION_ID}
        onCancel={onCancel}
        onSuccess={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
