"use client";

import { useEffect, useState } from "react";
import type { FirebaseOptions } from "firebase/app";
import {
  SEAT_STATUS_COLLECTION, SEAT_STATUS_META_COLLECTION, seatStatusData,
  type SeatStatusEntry, type SeatStatusSettings, type SeatStatusSnapshot,
} from "@/lib/seat-status";

export type SeatConnection = "connecting" | "live" | "polling" | "offline" | "auth-required";
type Access = {
  customToken: string | null;
  expiresAt: number;
  firebaseConfig: FirebaseOptions;
  emulators: { firestore: { host: string; port: number } | null; auth: { host: string; port: number } | null };
};

let firebaseClient: Promise<{
  db: import("firebase/firestore").Firestore;
  auth: import("firebase/auth").Auth;
  firestore: typeof import("firebase/firestore");
  signInWithCustomToken: typeof import("firebase/auth").signInWithCustomToken;
}> | undefined;

function client(access: Access) {
  firebaseClient ??= (async () => {
    const [{ initializeApp, getApps }, firestore, authentication] = await Promise.all([
      import("firebase/app"), import("firebase/firestore"), import("firebase/auth"),
    ]);
    const name = "bloom-seat-display";
    const existing = getApps().find((app) => app.name === name);
    const app = existing ?? initializeApp(access.firebaseConfig, name);
    const auth = existing ? authentication.getAuth(app) : authentication.initializeAuth(app, { persistence: authentication.inMemoryPersistence });
    const db = firestore.getFirestore(app);
    if (!existing && access.emulators.auth) {
      authentication.connectAuthEmulator(auth, `http://${access.emulators.auth.host}:${access.emulators.auth.port}`, { disableWarnings: true });
    }
    if (!existing && access.emulators.firestore) {
      firestore.connectFirestoreEmulator(db, access.emulators.firestore.host, access.emulators.firestore.port);
    }
    return { db, auth, firestore, signInWithCustomToken: authentication.signInWithCustomToken };
  })().catch((error) => { firebaseClient = undefined; throw error; });
  return firebaseClient;
}

/** One owner for listeners, retries and fallback; late results are ignored on cleanup. */
export function watchSeatStatus(
  onSnapshot: (snapshot: SeatStatusSnapshot) => void,
  onConnection: (state: SeatConnection) => void,
) {
  let stopped = false;
  let epoch = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setTimeout> | undefined;
  let initialTimeout: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let subscriptions: (() => void)[] = [];
  let polling = false;
  const requests = new AbortController();

  async function request(url: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    requests.signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 15_000);
    try {
      return await fetch(url, { ...init, credentials: "same-origin", cache: "no-store", signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      requests.signal.removeEventListener("abort", abort);
    }
  }

  function clearListeners() {
    epoch++;
    subscriptions.forEach((unsubscribe) => unsubscribe());
    subscriptions = [];
    clearTimeout(initialTimeout);
  }

  function requireAuth() {
    if (stopped) return;
    clearListeners();
    clearTimeout(retry);
    clearTimeout(poll);
    clearTimeout(expiry);
    polling = false;
    onConnection("auth-required");
  }

  async function pollOnce() {
    if (stopped || !polling) return;
    try {
      const response = await request("/api/seat-status");
      if (stopped || !polling) return;
      if (response.status === 401 || response.status === 404) { requireAuth(); return; }
      if (!response.ok) throw new Error("Seat snapshot unavailable");
      const snapshot = await response.json() as SeatStatusSnapshot;
      if (stopped || !polling) return;
      onSnapshot(snapshot);
      onConnection("polling");
    } catch {
      if (!stopped && polling) onConnection("offline");
    }
    if (!stopped && polling) poll = setTimeout(pollOnce, 5_000);
  }

  function fallback() {
    if (stopped) return;
    clearListeners();
    if (!polling) { polling = true; void pollOnce(); }
    clearTimeout(retry);
    retry = setTimeout(connect, 30_000);
  }

  async function connect() {
    if (stopped) return;
    clearListeners();
    const attempt = epoch;
    const current = () => !stopped && attempt === epoch;
    try {
      const response = await request("/api/seat-status/access", { method: "POST" });
      if (!current()) return;
      if (response.status === 401 || response.status === 404) { requireAuth(); return; }
      if (!response.ok) throw new Error("Display access unavailable");
      const access = await response.json() as Access;
      if (!current()) return;
      clearTimeout(expiry);
      expiry = setTimeout(requireAuth, Math.max(0, access.expiresAt - Date.now()));
      if (!access.customToken) { fallback(); return; }
      initialTimeout = setTimeout(() => { if (current()) fallback(); }, 10_000);
      const { db, auth, firestore, signInWithCustomToken } = await client(access);
      if (!current()) return;
      await signInWithCustomToken(auth, access.customToken);
      if (!current()) return;

      let entries: SeatStatusEntry[] = [];
      let settings: SeatStatusSettings = { open: false, updatedAt: null };
      let entriesConfirmed = false;
      let settingsConfirmed = false;
      function publish() {
        if (!current() || !entriesConfirmed || !settingsConfirmed) return;
        clearTimeout(initialTimeout);
        clearTimeout(poll);
        polling = false;
        onSnapshot({ entries, checkIn: settings, verifiedAt: new Date().toISOString() });
        onConnection("live");
      }
      function cached() {
        if (!current()) return;
        onConnection("connecting");
        clearTimeout(initialTimeout);
        initialTimeout = setTimeout(() => { if (current()) fallback(); }, 10_000);
      }
      const failed = (error: { code?: string }) => {
        if (!current()) return;
        console.warn("Seat display listener unavailable:", error.code ?? "unknown");
        fallback();
      };
      subscriptions.push(firestore.onSnapshot(
        firestore.collection(db, SEAT_STATUS_COLLECTION), { includeMetadataChanges: true },
        (snapshot) => {
          if (!current()) return;
          entriesConfirmed = !snapshot.metadata.fromCache;
          if (!entriesConfirmed) { cached(); return; }
          entries = snapshot.docs.map((doc) => ({ id: doc.id, ...seatStatusData(doc.data()) }));
          publish();
        }, failed,
      ));
      subscriptions.push(firestore.onSnapshot(
        firestore.doc(db, SEAT_STATUS_META_COLLECTION, "checkIn"), { includeMetadataChanges: true },
        (snapshot) => {
          if (!current()) return;
          settingsConfirmed = !snapshot.metadata.fromCache;
          if (!settingsConfirmed) { cached(); return; }
          const data = snapshot.data();
          settings = { open: data?.open === true, updatedAt: typeof data?.updatedAt === "string" ? data.updatedAt : null };
          publish();
        }, failed,
      ));
    } catch (error) {
      if (current()) {
        console.warn("Seat display live setup unavailable:", (error as { code?: string })?.code ?? (error instanceof Error ? error.message : "network"));
        fallback();
      }
    }
  }

  function online() { clearTimeout(retry); void connect(); }
  function offline() { fallback(); onConnection("offline"); }
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);
  onConnection("connecting");
  void connect();
  return () => {
    stopped = true;
    requests.abort();
    clearListeners();
    clearTimeout(retry);
    clearTimeout(poll);
    clearTimeout(expiry);
    window.removeEventListener("online", online);
    window.removeEventListener("offline", offline);
  };
}

export function useSeatStatus(sessionVersion: number, demo: boolean) {
  const [snapshot, setSnapshot] = useState<SeatStatusSnapshot | null>(null);
  const [connection, setConnection] = useState<SeatConnection>("connecting");
  useEffect(() => {
    if (demo) return;
    return watchSeatStatus(setSnapshot, setConnection);
  }, [sessionVersion, demo]);
  return { snapshot, connection };
}
