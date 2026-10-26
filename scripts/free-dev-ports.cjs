#!/usr/bin/env node
/**
 * Frees ports used by `npm run dev` (Next + Firebase emulators) so a second
 * start does not fail with "port taken".
 */
const { execSync } = require("node:child_process");

const ports = [3059, 4000, 8080, 9199, 4400, 4500, 9150];

function listeningPids(port) {
  const run = (command) =>
    execSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

  if (process.platform === "win32") {
    // netstat columns: Proto, Local Address, Foreign Address, State, PID
    return run("netstat -ano -p TCP")
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .filter(
        (cols) =>
          cols[3] === "LISTENING" && cols[1]?.endsWith(`:${port}`),
      )
      .map((cols) => cols[4]);
  }

  return run(`lsof -tiTCP:${port} -sTCP:LISTEN`).trim().split(/\s+/);
}

for (const port of ports) {
  try {
    const pids = [...new Set(listeningPids(port))].filter(
      (pid) => pid && pid !== "0",
    );
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
