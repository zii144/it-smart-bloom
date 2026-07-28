import { existsSync, readFileSync } from "node:fs";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";
import { firebasePublicConfig } from "@/lib/firebase-public-config";

let app: App | null = null;
let loggedTarget = false;

function loadServiceAccount() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (inline) {
    return JSON.parse(inline) as Record<string, string>;
  }

  const fromFile = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (fromFile && existsSync(fromFile)) {
    return JSON.parse(readFileSync(fromFile, "utf8")) as Record<string, string>;
  }

  return null;
}

/**
 * Admin SDKs auto-route to local emulators when these hosts are set
 * (no `http://` prefix). Never set them on Vercel.
 */
export function isFirebaseEmulator() {
  return Boolean(
    process.env.FIRESTORE_EMULATOR_HOST?.trim() ||
      process.env.FIREBASE_STORAGE_EMULATOR_HOST?.trim(),
  );
}

function logFirebaseTarget(projectId: string) {
  if (loggedTarget) return;
  loggedTarget = true;

  if (isFirebaseEmulator()) {
    console.info(
      `[firebase] using emulators for ${projectId}`,
      `(firestore=${process.env.FIRESTORE_EMULATOR_HOST ?? "off"}`,
      `storage=${process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? "off"})`,
    );
    return;
  }

  console.info(`[firebase] using live project ${projectId}`);
}

/** Returns null when Firebase is not configured so local/tests stay offline-friendly. */
export function getFirebaseApp() {
  if (app) return app;
  if (getApps().length) {
    app = getApps()[0]!;
    return app;
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID?.trim() || firebasePublicConfig.projectId;
  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET?.trim() ||
    firebasePublicConfig.storageBucket;
  const emulator = isFirebaseEmulator();
  const serviceAccount = loadServiceAccount();

  // Emulators only need a project id. Live Cloud needs a real service account.
  if (!projectId || (!emulator && !serviceAccount)) {
    return null;
  }

  app = initializeApp(
    emulator
      ? { projectId, storageBucket }
      : {
          credential: cert(serviceAccount!),
          projectId,
          storageBucket,
        },
  );
  logFirebaseTarget(projectId);
  return app;
}

export function getDb(): Firestore | null {
  const firebase = getFirebaseApp();
  return firebase ? getFirestore(firebase) : null;
}

export function getBucket() {
  const firebase = getFirebaseApp();
  if (!firebase) return null;
  const storage: Storage = getStorage(firebase);
  return storage.bucket();
}

export function isFirebaseConfigured() {
  return Boolean(getFirebaseApp());
}
