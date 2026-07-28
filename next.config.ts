import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The booth is opened over the Mac's LAN IP so a phone can scan the QR code.
   * Without these origins Next blocks the dev-only `/_next/*` assets, the
   * client bundle never loads, and `/s/[id]` freezes on its server-rendered
   * markup with no timer and no polling.
   */
  allowedDevOrigins: [
    "192.168.0.238",
    "192.168.0.*",
    "192.168.1.*",
    "10.0.0.*",
    "*.local",
  ],
};

export default nextConfig;
