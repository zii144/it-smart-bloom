import {
  isFirebaseConfigured,
  isFirebaseEmulator,
} from "@/lib/firebase-admin";
import { isImageTuningEnabled } from "@/lib/runtime-env";
import { sessionsDataDir } from "@/lib/sessions";

export type AdminHealth = {
  firebaseConfigured: boolean;
  firebaseEmulator: boolean;
  firestoreHost: string | null;
  storageHost: string | null;
  vercelEnv: string | null;
  nodeEnv: string | null;
  imageTuning: boolean;
  hasOpenAiKey: boolean;
  hasOpenAiPrompt: boolean;
  hasRoadTeacherUrl: boolean;
  hasRoadTeacherKey: boolean;
  dataDir: string;
};

export function getAdminHealth(): AdminHealth {
  return {
    firebaseConfigured: isFirebaseConfigured(),
    firebaseEmulator: isFirebaseEmulator(),
    firestoreHost: process.env.FIRESTORE_EMULATOR_HOST?.trim() || null,
    storageHost: process.env.FIREBASE_STORAGE_EMULATOR_HOST?.trim() || null,
    vercelEnv:
      process.env.VERCEL_ENV?.trim() ||
      process.env.NEXT_PUBLIC_VERCEL_ENV?.trim() ||
      null,
    nodeEnv: process.env.NODE_ENV ?? null,
    imageTuning: isImageTuningEnabled(),
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
    hasOpenAiPrompt: Boolean(process.env.OPENAI_IMAGE_SYSTEM_PROMPT?.trim()),
    hasRoadTeacherUrl: Boolean(
      process.env.ROAD_TEACHER_AVATAR_API_URL?.trim(),
    ),
    hasRoadTeacherKey: Boolean(
      process.env.ROAD_TEACHER_AVATAR_API_KEY?.trim(),
    ),
    dataDir: sessionsDataDir(),
  };
}
