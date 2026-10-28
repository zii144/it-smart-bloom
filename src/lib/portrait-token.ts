import { createHash, randomBytes } from "node:crypto";
import { getDb } from "@/lib/firebase-admin";

const TTL_MS = 5 * 60_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class PortraitTicketError extends Error {
  constructor(public status = 404) {
    super(
      status === 503
        ? "暫時無法建立圖片連結，請稍後再試。"
        : "圖片連結已失效，請重新操作。",
    );
    this.name = "PortraitTicketError";
  }
}

function tokenKey(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Shared Firestore state is required: the mint and redeem can hit different instances. */
export async function mintPortraitTicket(sessionId: string) {
  const db = getDb();
  if (!db) throw new PortraitTicketError(503);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
  await db.collection("portraitTickets").doc(tokenKey(token)).create({
    sessionId,
    expiresAt,
    redeemedAt: null,
  });
  return { token, expiresAt };
}

/** Claim atomically before serving bytes; two concurrent redeemers cannot both win. */
export async function redeemPortraitTicket(token: string) {
  if (!TOKEN_PATTERN.test(token)) throw new PortraitTicketError();
  const db = getDb();
  if (!db) throw new PortraitTicketError(503);
  const ref = db.collection("portraitTickets").doc(tokenKey(token));
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const ticket = snapshot.data();
    const expiresAt =
      typeof ticket?.expiresAt === "string"
        ? Date.parse(ticket.expiresAt)
        : NaN;
    if (
      !ticket ||
      ticket.redeemedAt !== null ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() ||
      typeof ticket.sessionId !== "string" ||
      !/^[A-Za-z0-9_-]{32}$/.test(ticket.sessionId)
    ) {
      throw new PortraitTicketError();
    }
    transaction.update(ref, { redeemedAt: new Date().toISOString() });
    return ticket.sessionId;
  });
}
