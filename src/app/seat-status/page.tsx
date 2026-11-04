import type { Metadata } from "next";
import { SeatStatusDashboard } from "@/components/seat-status-dashboard";

export const metadata: Metadata = {
  title: "即時座位看板",
  description: "智晟綻放活動報到與座位即時看板",
  robots: { index: false, follow: false },
};

export default async function SeatStatusPage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const { preview } = await searchParams;
  return <SeatStatusDashboard initialPreview={preview === "1"} />;
}
