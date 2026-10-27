/**
 * The four event-day guest journeys, end to end through the real route
 * handlers, Firestore and Firebase Storage (emulators). Portraits use fake
 * generation, so no OpenAI key is involved.
 *
 * Runs only under `npm run test:emulator` (test emulators on 8181 / 9299);
 * every test wipes Firestore there.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as checkIn } from "@/app/api/check-in/route";
import { GET as getPortrait } from "@/app/api/check-in/portrait/[token]/route";
import { POST as verifyGuest } from "@/app/api/roster/verify/route";
import { POST as createSessionRoute } from "@/app/api/sessions/route";
import { firebasePublicConfig } from "@/lib/firebase-public-config";
import { parseRosterInput } from "@/lib/roster";
import {
  createRosterEntry,
  listRosterEntries,
  setCheckInOpen,
} from "@/lib/roster-store";
import { deleteSession, getSession } from "@/lib/sessions";
import { loadSuccessView } from "@/lib/success-view";
import { imageFile } from "./helpers";

const { afterMock } = vi.hoisted(() => ({ afterMock: vi.fn() }));
vi.mock("next/server", () => ({ after: afterMock }));

const TEST_EMULATOR_HOST = "127.0.0.1:8181";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

const GUEST_WITH_PHOTO = { name: "測試甲", phone: "0900-000-001" };
const GUEST_WITHOUT_PHOTO = { name: "測試乙", phone: "0900000002" };
const STRANGER = { name: "路人丙", phone: "0900000003" };

async function clearFirestore() {
  const projectId =
    process.env.FIREBASE_PROJECT_ID?.trim() || firebasePublicConfig.projectId;
  const response = await fetch(
    `http://${emulatorHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(`Emulator reset failed: ${response.status}`);
}

function json(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "198.51.100.20" },
    body: JSON.stringify(body),
  });
}

/** The booth: name, phone and photo, with fake generation so no OpenAI call. */
function submitPhoto(guest: { name: string; phone: string }) {
  const body = new FormData();
  body.set("image", imageFile());
  body.set("name", guest.name);
  body.set("phone", guest.phone);
  body.set("imageOptions", JSON.stringify({ fakeGenerate: true }));
  return createSessionRoute(
    new Request("https://it-smart-bloom.vercel.app/api/sessions", {
      method: "POST",
      headers: { "x-forwarded-for": "198.51.100.20" },
      body,
    }),
  );
}

/** Runs the background render the route queued with `after()`. */
async function finishRendering() {
  for (const [callback] of afterMock.mock.calls) await callback();
  afterMock.mockClear();
}

describe.skipIf(emulatorHost !== TEST_EMULATOR_HOST)("event-day guest flows", () => {
  beforeEach(async () => {
    await clearFirestore();
    afterMock.mockReset();
    // Fake generation is only honoured while image tuning is on.
    process.env.NEXT_PUBLIC_IMAGE_TUNING = "true";
    for (const [guest, seat] of [
      [GUEST_WITH_PHOTO, "A1"],
      [GUEST_WITHOUT_PHOTO, "A2"],
    ] as const) {
      await createRosterEntry(
        parseRosterInput({ name: guest.name, mobile: guest.phone, seat }),
      );
    }
  });

  it("case 1: on the roster with a photo → check in on event day → gets the portrait", async () => {
    // Before the event: the roster lets them in and the photo is accepted.
    expect((await verifyGuest(json("http://x/api/roster/verify", GUEST_WITH_PHOTO))).status).toBe(200);
    const created = await submitPhoto(GUEST_WITH_PHOTO);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    // The success card greets them but does not hand out the portrait.
    const success = await loadSuccessView(id);
    expect(success).toMatchObject({ kind: "ready", guestName: "測試甲", seat: "A1" });
    expect(JSON.stringify(success)).not.toContain(id);

    await finishRendering();
    expect((await getSession(id)).status).toBe("complete");

    // Event day: the session link and the server's disk copy are long gone.
    // The portrait must come back from Firebase Storage.
    await deleteSession(id);

    await setCheckInOpen(true);
    const arrival = await checkIn(json("http://x/api/check-in", GUEST_WITH_PHOTO));
    expect(arrival.status).toBe(200);
    const payload = (await arrival.json()) as {
      name: string;
      seat: string;
      alreadyCheckedIn: boolean;
      portrait: { status: string; url: string | null };
    };
    expect(payload).toMatchObject({
      name: "測試甲",
      seat: "A1",
      alreadyCheckedIn: false,
      portrait: { status: "complete" },
    });
    expect(payload.portrait.url).toMatch(/^\/api\/check-in\/portrait\/[A-Za-z0-9_-]{43}$/);

    const token = payload.portrait.url!.split("/").pop()!;
    const image = await getPortrait(
      new Request(`http://x${payload.portrait.url}?download=1`),
      { params: Promise.resolve({ token }) },
    );
    expect(image.status).toBe(200);
    expect(image.headers.get("Content-Type")).toMatch(/^image\//);
    expect(image.headers.get("Content-Disposition")).toMatch(/^attachment/);
    expect((await image.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const [entry] = (await listRosterEntries()).filter((e) => e.name === "測試甲");
    expect(entry).toMatchObject({ checkInSource: "self", portraitStatus: "complete" });
  });

  it("case 2: on the roster without a photo → check in → done, nothing to collect", async () => {
    await setCheckInOpen(true);

    const arrival = await checkIn(json("http://x/api/check-in", GUEST_WITHOUT_PHOTO));

    expect(arrival.status).toBe(200);
    expect(await arrival.json()).toMatchObject({
      name: "測試乙",
      seat: "A2",
      alreadyCheckedIn: false,
      portrait: { status: null, url: null },
    });
    const [entry] = (await listRosterEntries()).filter((e) => e.name === "測試乙");
    expect(entry?.checkedInAt).toBeTruthy();
  });

  it("case 3: not on the roster → tries to submit a photo → refused, nothing stored", async () => {
    const verify = await verifyGuest(json("http://x/api/roster/verify", STRANGER));
    expect(verify.status).toBe(403);

    // Calling the API directly does not get around the booth's check.
    const created = await submitPhoto(STRANGER);
    expect(created.status).toBe(403);
    expect((await created.json()).error).toContain("找不到");
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("case 3b: a roster guest giving the wrong phone is refused too", async () => {
    const created = await submitPhoto({ name: GUEST_WITH_PHOTO.name, phone: "0911111111" });
    expect(created.status).toBe(403);
  });

  it("case 4: not on the roster → tries to check in on event day → refused", async () => {
    await setCheckInOpen(true);

    const arrival = await checkIn(json("http://x/api/check-in", STRANGER));

    expect(arrival.status).toBe(403);
    expect((await arrival.json()).error).toContain("找不到");
    const roster = await listRosterEntries();
    expect(roster.some((entry) => entry.checkedInAt)).toBe(false);
  });

  it("nobody can check in before an admin opens check-in", async () => {
    const arrival = await checkIn(json("http://x/api/check-in", GUEST_WITH_PHOTO));
    expect(arrival.status).toBe(403);
    expect(await arrival.json()).toMatchObject({ closed: true });
  });
});
