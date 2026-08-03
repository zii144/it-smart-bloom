import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  AdminDashboard,
  AdminLoginForm,
  type AdminDashboardPayload,
} from "@/components/admin-dashboard";
import {
  ADMIN_COOKIE_NAME,
  resolveAdminAuth,
} from "@/lib/admin-auth";
import { getAdminHealth } from "@/lib/admin-health";
import { defaultImageOptions } from "@/lib/image-options";
import { listArchiveSessions } from "@/lib/portrait-archive";
import { listLocalSessions } from "@/lib/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<{ key?: string }>;
};

async function loadDashboard(): Promise<AdminDashboardPayload> {
  const [local, archive] = await Promise.all([
    listLocalSessions({ limit: 50 }),
    listArchiveSessions({ limit: 50 }),
  ]);

  return {
    health: getAdminHealth(),
    imageDefaults: defaultImageOptions(),
    localSessions: local.map((session) => ({
      id: session.id,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.generationStartedAt ?? session.createdAt,
      identity: session.identity
        ? `${session.identity.kind}:${session.identity.value}`
        : null,
      avatarRequestStatus: null,
      fakeGenerate: Boolean(session.generationOptions?.fakeGenerate),
      source: session.source ?? null,
      error: session.error ?? null,
      inputUrl: `/api/sessions/${session.id}/image?kind=input`,
      resultUrl:
        session.status === "complete"
          ? `/api/sessions/${session.id}/image?kind=result`
          : null,
    })),
    archiveSessions: archive.sessions.map((session) => ({
      id: session.sessionId,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      identity:
        session.identityKind && session.identityValue
          ? `${session.identityKind}:${session.identityValue}`
          : null,
      avatarRequestStatus: session.avatarRequestStatus,
      fakeGenerate: null,
      source: session.source ?? null,
      error: session.error,
      inputUrl: session.storage.inputPath
        ? `/api/admin30910/sessions/${session.sessionId}/image?kind=input`
        : null,
      resultUrl: session.storage.resultPath
        ? `/api/admin30910/sessions/${session.sessionId}/image?kind=result`
        : null,
    })),
    archiveError: archive.error,
  };
}

export default async function AdminPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const jar = await cookies();
  const requestHeaders = await headers();

  const auth = resolveAdminAuth({
    cookieToken: jar.get(ADMIN_COOKIE_NAME)?.value,
    authorization: requestHeaders.get("authorization"),
    key: params.key ?? null,
  });

  if (!auth.ok && auth.reason === "disabled") {
    notFound();
  }

  // Exchange ?key= for a cookie without leaving the secret in the address bar.
  if (auth.ok && auth.via === "key" && params.key) {
    redirect(
      `/api/admin30910/login?key=${encodeURIComponent(params.key)}`,
    );
  }

  if (!auth.ok) {
    return <AdminLoginForm />;
  }

  const initial = await loadDashboard();
  return <AdminDashboard initial={initial} />;
}
