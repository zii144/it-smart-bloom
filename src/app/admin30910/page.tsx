import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AdminDashboard, AdminLoginForm } from "@/components/admin-dashboard";
import { loadAdminDashboard } from "@/lib/admin-dashboard-data";
import {
  ADMIN_COOKIE_NAME,
  resolveAdminAuth,
} from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const jar = await cookies();
  const requestHeaders = await headers();

  const auth = resolveAdminAuth({
    cookieToken: jar.get(ADMIN_COOKIE_NAME)?.value,
    authorization: requestHeaders.get("authorization"),
  });

  if (!auth.ok && auth.reason === "disabled") {
    notFound();
  }

  if (!auth.ok) {
    return <AdminLoginForm />;
  }

  const initial = await loadAdminDashboard();
  return <AdminDashboard initial={initial} />;
}
