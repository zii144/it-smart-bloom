/**
 * Fails the build when a deployment is wired to a backend its stage may not
 * touch — a preview reading production data, or production calling the dev
 * road-teacher function.
 *
 * Runs as `prebuild`, so it gates every Vercel build. Run under Node's type
 * stripping, which is why it imports the policy by relative path with an
 * explicit extension and the policy module has no dependencies.
 */

import { createRequire } from "node:module";
import {
  checkDeployEnvironment,
  describeEnvironment,
  ENVIRONMENT_POLICY,
} from "../src/lib/deploy-env.ts";

// `@next/env` is CommonJS, and this file runs as ESM under type stripping.
const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as {
  loadEnvConfig: (dir: string, dev: boolean) => unknown;
};

// `prebuild` runs before the Next CLI loads .env files, so mirror its loading
// here — otherwise a local build validates a different set of values than the
// one it compiles. Shell and CI values still win.
loadEnvConfig(process.cwd(), false);

const report = checkDeployEnvironment();
const branch =
  process.env.VERCEL_GIT_COMMIT_REF || process.env.GIT_BRANCH || "unknown";

if (report.problems.length === 0) {
  console.log(`✅ env guard: ${describeEnvironment(report)} (branch: ${branch})`);
  process.exit(0);
}

const policy = ENVIRONMENT_POLICY[report.stage];
const log = report.enforced ? console.error : console.warn;

log(
  report.enforced
    ? `\n❌ env guard: this ${report.stage} build is wired to the wrong backend.\n`
    : `\n⚠️  env guard: local build is not wired to the ${report.stage} backends.\n` +
        "   Reported, not enforced — local runtime uses the emulators.\n",
);
log(`   branch: ${branch}`);
log(`   ${report.stage} may only reach:`);
log(`     Firebase      ${policy.firebaseProjectId}`);
log(`     road-teacher  ${policy.roadTeacherProjectId}\n`);

for (const problem of report.problems) {
  log(`   • ${problem.variable} ${problem.detail}`);
  log(`     → ${problem.fix}\n`);
}

log("   Set these per scope in Vercel → Settings → Environment Variables.");
log("   The allowed pairings live in src/lib/deploy-env.ts, so changing them");
log("   is a reviewed change rather than a dashboard edit.\n");

process.exit(report.enforced ? 1 : 0);
