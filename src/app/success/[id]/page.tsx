import type { Metadata } from "next";
import { GuestShell } from "@/components/invitation";
import { SuccessCard } from "@/components/success-card";
import { loadSuccessView } from "@/lib/success-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "照片已收到",
  description: "感謝參與路老師似顏繪。",
  robots: { index: false, follow: false },
};

export default async function SuccessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <GuestShell>
      <SuccessCard view={await loadSuccessView(id)} />
    </GuestShell>
  );
}
