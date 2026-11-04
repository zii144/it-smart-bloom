import { getDb } from "@/lib/firebase-admin";
import { normalizeSeatLabel, type SeatGuest } from "@/lib/seat-status";

/** Read only selected guests, and recheck their current seat after reassignment. */
export async function readSeatGuests(seat: string, ids: string[]): Promise<SeatGuest[]> {
  const db = getDb();
  if (!db) throw new Error("Seat guest lookup requires Firestore");
  const docs = await db.getAll(...ids.map((id) => db.collection("roster").doc(id)), {
    fieldMask: ["name", "role", "seat", "checkedInAt"],
  });
  return docs.flatMap((doc) => {
    const data = doc.data();
    if (!data || typeof data.seat !== "string" || normalizeSeatLabel(data.seat) !== seat) return [];
    return [{
      id: doc.id,
      name: typeof data.name === "string" ? data.name : "未提供姓名",
      role: typeof data.role === "string" ? data.role : "",
      seat,
      checkedInAt: typeof data.checkedInAt === "string" ? data.checkedInAt : null,
    }];
  });
}
