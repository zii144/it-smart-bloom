#!/usr/bin/env node
/**
 * Frees ports used by `npm run dev` (Next + Firebase emulators) so a second
 * start does not fail with "port taken".
 */
const { execSync } = require("node:child_process");

const ports = [3059, 4000, 8080, 9199, 4400, 4500, 9150];

for (const port of ports) {
  try {
    const pids = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), "SIGTERM");
      } catch {
        // already gone
      }
    }
  } catch {
    // nothing listening
  }
}
