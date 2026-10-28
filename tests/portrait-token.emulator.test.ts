import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/firebase-admin";
import { mintPortraitTicket, redeemPortraitTicket } from "@/lib/portrait-token";

const HOST = "127.0.0.1:8181";
describe.skipIf(process.env.FIRESTORE_EMULATOR_HOST !== HOST)(
  "portrait tickets on Firestore",
  () => {
    beforeEach(async () => {
      const db = getDb()!;
      const snapshot = await db.collection("portraitTickets").get();
      await Promise.all(snapshot.docs.map((doc) => doc.ref.delete()));
    });

    it("stores only a token hash and a short-lived, non-identifying capability", async () => {
      const ticket = await mintPortraitTicket("a".repeat(32));
      expect(ticket.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Date.parse(ticket.expiresAt) - Date.now()).toBeLessThanOrEqual(
        300_000,
      );
      const snap = await getDb()!.collection("portraitTickets").get();
      expect(snap.docs[0]!.id).toBe(
        createHash("sha256").update(ticket.token).digest("hex"),
      );
      expect(snap.docs[0]!.data()).toEqual({
        sessionId: "a".repeat(32),
        expiresAt: ticket.expiresAt,
        redeemedAt: null,
      });
    });

    it("allows exactly one redeemer even when multiple server instances race", async () => {
      const ticket = await mintPortraitTicket("a".repeat(32));
      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => redeemPortraitTicket(ticket.token)),
      );
      expect(results.filter((result) => result.status === "fulfilled")).toEqual(
        [{ status: "fulfilled", value: "a".repeat(32) }],
      );
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(3);
      await expect(redeemPortraitTicket(ticket.token)).rejects.toMatchObject({
        status: 404,
      });
    });

    it("rejects at the exact expiry boundary", async () => {
      const ticket = await mintPortraitTicket("a".repeat(32));
      vi.useFakeTimers({ now: Date.parse(ticket.expiresAt), toFake: ["Date"] });
      try {
        await expect(redeemPortraitTicket(ticket.token)).rejects.toMatchObject({
          status: 404,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("rejects unknown and malformed tokens without revealing which case occurred", async () => {
      for (const token of ["../invalid", "x".repeat(43)])
        await expect(redeemPortraitTicket(token)).rejects.toMatchObject({
          status: 404,
        });
    });
  },
);
