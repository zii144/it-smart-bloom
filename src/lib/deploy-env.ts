/**
 * Which backends each deployment stage is allowed to talk to.
 *
 * Vercel gives every branch its own preview URL, but a Firebase project and a
 * Cloud Function are not per-branch — there is one of each per stage. So the
 * thing that must be enforced is not "which deployment am I" but "is this
 * deployment wired to the backends its stage is allowed to touch".
 *
 * Checked at build time (`scripts/env-guard.ts`, run as `prebuild`) so a
 * mis-wired deployment fails to build rather than quietly reading and writing
 * the wrong project's data.
 *
 * Dependency-free on purpose: the build guard imports this file directly under
 * Node's type stripping, so it must not use path aliases or app-only imports.
 */

export type DeployStage = "production" | "preview" | "development";

export type StagePolicy = {
  /** The only Firebase project this stage may read or write. */
  firebaseProjectId: string;
  /** The only road-teacher Firebase project this stage may call. */
  roadTeacherProjectId: string;
  /**
   * Whether APP_BASE_URL may be set. A preview must leave it unset so the QR
   * resolves to the preview deployment itself; a hardcoded base URL would send
   * a guest scanning a preview booth's QR to production. Local development sets
   * it deliberately, to the Mac's LAN IP, so a phone can reach the booth.
   */
  allowsFixedBaseUrl: boolean;
  /**
   * Whether a mismatch fails the build. The deployed stages are enforced; local
   * builds warn, because local runtime is emulated and a compile check connects
   * to nothing — a guard that blocks `npm run build` just gets deleted.
   */
  enforced: boolean;
};

/**
 * Update this when a project is created or renamed. It is deliberately a
 * literal rather than configuration: the whole point is that the mapping is
 * reviewed in a pull request, not editable in a dashboard.
 */
export const ENVIRONMENT_POLICY: Record<DeployStage, StagePolicy> = {
  production: {
    firebaseProjectId: "it-smart-bloom-tmp",
    roadTeacherProjectId: "road-teacher-prod",
    allowsFixedBaseUrl: true,
    enforced: true,
  },
  preview: {
    firebaseProjectId: "it-smart-bloom-dev",
    roadTeacherProjectId: "road-teacher-fafb1",
    allowsFixedBaseUrl: false,
    enforced: true,
  },
  development: {
    firebaseProjectId: "it-smart-bloom-dev",
    roadTeacherProjectId: "road-teacher-fafb1",
    allowsFixedBaseUrl: true,
    enforced: false,
  },
};

export type EnvironmentProblem = {
  variable: string;
  detail: string;
  fix: string;
};

export type EnvironmentReport = {
  stage: DeployStage;
  /** True when Firestore/Storage are local, so the project id is only a label. */
  emulated: boolean;
  /** False for local builds, where problems are reported but do not fail. */
  enforced: boolean;
  problems: EnvironmentProblem[];
};

type Env = Record<string, string | undefined>;

/**
 * Vercel sets `VERCEL_ENV` itself, so it cannot be typed into the wrong scope
 * in the dashboard. Deriving the stage from it — rather than from a variable a
 * human sets — is what stops the failure this guard exists to prevent: a
 * production deployment that *claims* to be a preview and is believed.
 */
export function resolveStage(env: Env = process.env): DeployStage {
  const vercelEnv = env.VERCEL_ENV?.trim();
  if (vercelEnv === "production") return "production";
  if (vercelEnv === "preview") return "preview";
  return "development";
}

function isEmulated(env: Env) {
  return Boolean(
    env.FIRESTORE_EMULATOR_HOST?.trim() ||
      env.FIREBASE_STORAGE_EMULATOR_HOST?.trim(),
  );
}

/**
 * A Cloud Function URL embeds its project:
 * `https://us-central1-road-teacher-fafb1.cloudfunctions.net/bloomIdentityChallenge`
 */
function describeRoadTeacherUrl(url: string, policy: StagePolicy) {
  const otherProjects = Object.values(ENVIRONMENT_POLICY)
    .map((entry) => entry.roadTeacherProjectId)
    .filter((id) => id !== policy.roadTeacherProjectId);

  if (url.includes(policy.roadTeacherProjectId)) return null;

  const wrong = otherProjects.find((id) => url.includes(id));
  return wrong
    ? `points at ${wrong}, which belongs to another stage`
    : `does not name ${policy.roadTeacherProjectId}, so the stage it reaches cannot be confirmed`;
}

export function checkDeployEnvironment(env: Env = process.env): EnvironmentReport {
  const stage = resolveStage(env);
  const policy = ENVIRONMENT_POLICY[stage];
  const emulated = isEmulated(env);
  const problems: EnvironmentProblem[] = [];

  // Emulated Firestore/Storage are local, so the project id is just a label and
  // no real project can be reached. The road-teacher check below still applies:
  // that call leaves the machine even when bloom's own data does not.
  if (!emulated) {
    const projectId = env.FIREBASE_PROJECT_ID?.trim();
    if (!projectId) {
      problems.push({
        variable: "FIREBASE_PROJECT_ID",
        detail: "is not set",
        fix: `set it to ${policy.firebaseProjectId} for the ${stage} scope`,
      });
    } else if (projectId !== policy.firebaseProjectId) {
      problems.push({
        variable: "FIREBASE_PROJECT_ID",
        detail: `is ${projectId}, but ${stage} may only use ${policy.firebaseProjectId}`,
        fix: `set it to ${policy.firebaseProjectId} for the ${stage} scope`,
      });
    }
  }

  const roadTeacherUrl = env.ROAD_TEACHER_IDENTITY_API_URL?.trim();
  if (roadTeacherUrl) {
    const mismatch = describeRoadTeacherUrl(roadTeacherUrl, policy);
    if (mismatch) {
      problems.push({
        variable: "ROAD_TEACHER_IDENTITY_API_URL",
        detail: mismatch,
        fix: `point it at the bloomIdentityChallenge function in ${policy.roadTeacherProjectId}`,
      });
    }
  }

  if (!policy.allowsFixedBaseUrl && env.APP_BASE_URL?.trim()) {
    problems.push({
      variable: "APP_BASE_URL",
      detail: `is set on ${stage}, so booth QR codes would point away from this deployment`,
      fix: `leave it unset outside production — the request origin is used instead`,
    });
  }

  return { stage, emulated, enforced: policy.enforced, problems };
}

/** One line for build logs and server startup, naming what was actually wired. */
export function describeEnvironment(report: EnvironmentReport) {
  const policy = ENVIRONMENT_POLICY[report.stage];
  const firebase = report.emulated
    ? "firebase=emulator"
    : `firebase=${policy.firebaseProjectId}`;
  return `stage=${report.stage} ${firebase} road-teacher=${policy.roadTeacherProjectId}`;
}
