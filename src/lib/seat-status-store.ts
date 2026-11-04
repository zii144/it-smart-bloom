import type { Firestore } from "firebase-admin/firestore";
import { getDb } from "@/lib/firebase-admin";
import {
  SEAT_STATUS_COLLECTION,
  SEAT_STATUS_META_COLLECTION,
  seatStatusData,
  type SeatStatusSnapshot,
} from "@/lib/seat-status";

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("Seat status requires Firestore");
  return db;
}

/** Re-read inside each transaction: a concurrent arrival/seat edit must win. */
export async function rebuildSeatStatus(db: Firestore = requireDb()) {
  const [roster, display] = await Promise.all([
    db.collection("roster").select().get(),
    db.collection(SEAT_STATUS_COLLECTION).select().get(),
  ]);
  const ids = [...new Set([...roster.docs, ...display.docs].map((doc) => doc.id))];
  for (let start = 0; start < ids.length; start += 20) {
    await Promise.all(ids.slice(start, start + 20).map((id) =>
      db.runTransaction(async (tx) => {
        const source = await tx.get(db.collection("roster").doc(id));
        const target = db.collection(SEAT_STATUS_COLLECTION).doc(id);
        if (source.exists) tx.set(target, seatStatusData(source.data()!));
        else tx.delete(target);
      }),
    ));
  }
  await db.runTransaction(async (tx) => {
    const settings = await tx.get(db.collection("rosterMeta").doc("checkIn"));
    const data = settings.data();
    tx.set(db.collection(SEAT_STATUS_META_COLLECTION).doc("checkIn"), {
      open: data?.open === true,
      updatedAt: typeof data?.updatedAt === "string" ? data.updatedAt : null,
    });
    tx.set(db.collection(SEAT_STATUS_META_COLLECTION).doc("schema"), { version: 1 });
  });
  return { entries: roster.size };
}

export async function ensureSeatStatusReady() {
  const db = requireDb();
  const schema = await db.collection(SEAT_STATUS_META_COLLECTION).doc("schema").get();
  if (schema.data()?.version !== 1) await rebuildSeatStatus(db);
}

/** Polling fallback reads only the same minimal documents as the live listener. */
export async function readSeatStatus(): Promise<SeatStatusSnapshot> {
  const db = requireDb();
  const [snapshot, meta] = await Promise.all([
    db.collection(SEAT_STATUS_COLLECTION).get(),
    db.collection(SEAT_STATUS_META_COLLECTION).doc("checkIn").get(),
  ]);
  return {
    entries: snapshot.docs.map((doc) => ({ id: doc.id, ...seatStatusData(doc.data()) })),
    checkIn: {
      open: meta.data()?.open === true,
      updatedAt: typeof meta.data()?.updatedAt === "string" ? meta.data()!.updatedAt : null,
    },
    verifiedAt: new Date().toISOString(),
  };
}
