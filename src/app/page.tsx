import { CameraBooth } from "@/components/camera-booth";
import {
  readPhotoSubmissionSettings,
  RosterUnavailableError,
} from "@/lib/roster-store";
import { isImageTuningEnabled } from "@/lib/runtime-env";

export const runtime = "nodejs";
// Read the admin's 欣然赴約 switch on every visit, not once at build time.
export const dynamic = "force-dynamic";

async function submissionsOpen() {
  try {
    return (await readPhotoSubmissionSettings()).open;
  } catch (error) {
    if (!(error instanceof RosterUnavailableError)) {
      console.error("Failed to read photo submission settings:", error);
    }
    // The submit routes check again, so showing the button here is safe.
    return true;
  }
}

export default async function Home() {
  return (
    <CameraBooth
      tuningEnabled={isImageTuningEnabled()}
      submissionsOpen={await submissionsOpen()}
    />
  );
}
