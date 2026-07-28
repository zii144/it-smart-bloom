import { CameraBooth } from "@/components/camera-booth";
import { isImageTuningEnabled } from "@/lib/runtime-env";

export default function Home() {
  return <CameraBooth tuningEnabled={isImageTuningEnabled()} />;
}
