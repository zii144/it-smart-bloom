import type { Metadata } from "next";
import { CheckInCard, type CheckInAvailability } from "@/components/check-in-card";
import { GuestShell } from "@/components/invitation";
import { readCheckInSettings, RosterUnavailableError } from "@/lib/roster-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "來賓報到",
  description: "成果展現場報到。",
  robots: { index: false, follow: false },
};

async function availability(): Promise<CheckInAvailability> {
  try {
    return (await readCheckInSettings()).open ? "open" : "closed";
  } catch (error) {
    if (!(error instanceof RosterUnavailableError)) {
      console.error("Failed to read check-in settings:", error);
    }
    return "unavailable";
  }
}

export default async function CheckInPage() {
  return (
    <GuestShell note="成果展報到">
      <CheckInCard availability={await availability()} />
    </GuestShell>
  );
}
