import type {
  AdminDashboardPayload,
  AdminSessionRow,
} from "@/components/admin-dashboard";
import { getAdminHealth } from "@/lib/admin-health";
import { defaultImageOptions } from "@/lib/image-options";
import { readSpendSnapshot } from "@/lib/image-spend";
import {
  countArchiveSessions,
  listArchiveSessions,
  type ArchiveRecord,
} from "@/lib/portrait-archive";
import { listLocalSessions, type ImageSession } from "@/lib/sessions";

/** Rows per dashboard fetch; older archive rows load on demand. */
export const ADMIN_SESSION_PAGE_SIZE = 50;

function toLocalRow(session: ImageSession): AdminSessionRow {
  return {
    id: session.id,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.generationStartedAt ?? session.createdAt,
    identity: session.identity
      ? `${session.identity.kind}:${session.identity.value}`
      : null,
    avatarRequestStatus: null,
    rosterEntryId: session.rosterEntryId ?? null,
    fakeGenerate: Boolean(session.generationOptions?.fakeGenerate),
    source: session.source ?? null,
    error: session.error ?? null,
    inputUrl: `/api/sessions/${session.id}/image?kind=input`,
    resultUrl:
      session.status === "complete"
        ? `/api/sessions/${session.id}/image?kind=result`
        : null,
  };
}

export function toArchiveRow(session: ArchiveRecord): AdminSessionRow {
  return {
    id: session.sessionId,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    identity:
      session.identityKind && session.identityValue
        ? `${session.identityKind}:${session.identityValue}`
        : null,
    avatarRequestStatus: session.avatarRequestStatus,
    rosterEntryId: session.rosterEntryId ?? null,
    fakeGenerate: null,
    source: session.source ?? null,
    error: session.error,
    inputUrl: session.storage.inputPath
      ? `/api/admin30910/sessions/${session.sessionId}/image?kind=input`
      : null,
    resultUrl: session.storage.resultPath
      ? `/api/admin30910/sessions/${session.sessionId}/image?kind=result`
      : null,
  };
}

export async function loadAdminDashboard(): Promise<AdminDashboardPayload> {
  const [local, archive, archiveCounts, spend] = await Promise.all([
    listLocalSessions({ limit: ADMIN_SESSION_PAGE_SIZE }),
    listArchiveSessions({ limit: ADMIN_SESSION_PAGE_SIZE }),
    countArchiveSessions(),
    readSpendSnapshot(),
  ]);

  return {
    health: getAdminHealth(),
    imageDefaults: defaultImageOptions(),
    spend,
    localSessions: local.map(toLocalRow),
    archiveSessions: archive.sessions.map(toArchiveRow),
    archiveCounts,
    archiveError: archive.error,
  };
}
