import type { Metadata } from "next";
import { SessionExperience } from "@/components/session-experience";

export const metadata: Metadata = {
  title: "你的路老師似顏繪",
  description: "你的私人路老師似顏繪創作空間。",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SessionExperience id={id} />;
}
