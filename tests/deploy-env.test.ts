import { describe, expect, it } from "vitest";
import {
  checkDeployEnvironment,
  describeEnvironment,
  ENVIRONMENT_POLICY,
  resolveStage,
} from "@/lib/deploy-env";

const DEV_RT = "https://us-central1-road-teacher-fafb1.cloudfunctions.net/bloomIdentityChallenge";
const PROD_RT = "https://us-central1-road-teacher-prod.cloudfunctions.net/bloomIdentityChallenge";

function wired(overrides: Record<string, string | undefined> = {}) {
  return checkDeployEnvironment({
    VERCEL_ENV: "preview",
    FIREBASE_PROJECT_ID: "it-smart-bloom-dev",
    ROAD_TEACHER_IDENTITY_API_URL: DEV_RT,
    ...overrides,
  });
}

function variables(report: ReturnType<typeof checkDeployEnvironment>) {
  return report.problems.map((problem) => problem.variable);
}

describe("resolveStage", () => {
  // Vercel sets VERCEL_ENV itself, which is the whole point: a human cannot
  // put the wrong value in the wrong dashboard scope.
  it("takes the stage from VERCEL_ENV", () => {
    expect(resolveStage({ VERCEL_ENV: "production" })).toBe("production");
    expect(resolveStage({ VERCEL_ENV: "preview" })).toBe("preview");
  });

  it("treats an absent or unknown VERCEL_ENV as local development", () => {
    expect(resolveStage({})).toBe("development");
    expect(resolveStage({ VERCEL_ENV: "" })).toBe("development");
    expect(resolveStage({ VERCEL_ENV: "staging" })).toBe("development");
  });

  // The failure this guard exists to prevent: production believing a variable
  // that says it is something else.
  it("ignores any other variable claiming to be the environment", () => {
    expect(
      resolveStage({ VERCEL_ENV: "production", NEXT_PUBLIC_ENVIRONMENT: "preview" }),
    ).toBe("production");
  });
});

describe("the two stages never share a backend", () => {
  it("separates every enforced stage's projects", () => {
    const prod = ENVIRONMENT_POLICY.production;
    const preview = ENVIRONMENT_POLICY.preview;

    expect(prod.firebaseProjectId).not.toBe(preview.firebaseProjectId);
    expect(prod.roadTeacherProjectId).not.toBe(preview.roadTeacherProjectId);
    expect(prod.enforced && preview.enforced).toBe(true);
  });

  it("lets only production pin a base URL", () => {
    expect(ENVIRONMENT_POLICY.production.allowsFixedBaseUrl).toBe(true);
    expect(ENVIRONMENT_POLICY.preview.allowsFixedBaseUrl).toBe(false);
  });
});

describe("checkDeployEnvironment", () => {
  it("passes a correctly wired preview", () => {
    const report = wired();

    expect(report.problems).toEqual([]);
    expect(report.enforced).toBe(true);
  });

  it("catches a preview pointed at the production Firebase project", () => {
    const report = wired({ FIREBASE_PROJECT_ID: "it-smart-bloom-tmp" });

    expect(variables(report)).toContain("FIREBASE_PROJECT_ID");
    expect(report.problems[0]?.detail).toContain("it-smart-bloom-tmp");
  });

  it("catches a preview calling the production road-teacher function", () => {
    const report = wired({ ROAD_TEACHER_IDENTITY_API_URL: PROD_RT });

    expect(variables(report)).toContain("ROAD_TEACHER_IDENTITY_API_URL");
    expect(report.problems[0]?.detail).toContain("road-teacher-prod");
  });

  it("catches production calling the dev road-teacher function", () => {
    const report = checkDeployEnvironment({
      VERCEL_ENV: "production",
      FIREBASE_PROJECT_ID: "it-smart-bloom-tmp",
      ROAD_TEACHER_IDENTITY_API_URL: DEV_RT,
    });

    expect(variables(report)).toEqual(["ROAD_TEACHER_IDENTITY_API_URL"]);
  });

  // A custom domain hides the project, so the stage cannot be confirmed.
  it("refuses a road-teacher URL that names no known project", () => {
    const report = wired({
      ROAD_TEACHER_IDENTITY_API_URL: "https://api.example.com/identity",
    });

    expect(variables(report)).toContain("ROAD_TEACHER_IDENTITY_API_URL");
    expect(report.problems[0]?.detail).toContain("cannot be confirmed");
  });

  // A pinned base URL would send a guest scanning the preview booth's QR to
  // whatever host is pinned — usually production.
  it("refuses a pinned APP_BASE_URL on preview but allows it on production", () => {
    expect(variables(wired({ APP_BASE_URL: "https://bloom.example.com" }))).toContain(
      "APP_BASE_URL",
    );

    const prod = checkDeployEnvironment({
      VERCEL_ENV: "production",
      FIREBASE_PROJECT_ID: "it-smart-bloom-tmp",
      ROAD_TEACHER_IDENTITY_API_URL: PROD_RT,
      APP_BASE_URL: "https://bloom.example.com",
    });
    expect(prod.problems).toEqual([]);
  });

  it("reports a missing Firebase project rather than assuming one", () => {
    const report = wired({ FIREBASE_PROJECT_ID: undefined });

    expect(variables(report)).toContain("FIREBASE_PROJECT_ID");
    expect(report.problems[0]?.detail).toContain("not set");
  });

  // Emulated data is local, so the project id is only a label.
  it("skips the Firebase check when the emulators are in use", () => {
    const report = wired({
      FIREBASE_PROJECT_ID: "anything-at-all",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    });

    expect(report.emulated).toBe(true);
    expect(variables(report)).not.toContain("FIREBASE_PROJECT_ID");
  });

  // ...but the road-teacher call still leaves the machine.
  it("still checks road-teacher when the emulators are in use", () => {
    const report = wired({
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      ROAD_TEACHER_IDENTITY_API_URL: PROD_RT,
    });

    expect(variables(report)).toContain("ROAD_TEACHER_IDENTITY_API_URL");
  });

  // A guard that blocks `npm run build` gets deleted; local reports, not fails.
  it("reports local problems without enforcing them", () => {
    const report = checkDeployEnvironment({
      FIREBASE_PROJECT_ID: "it-smart-bloom-tmp",
    });

    expect(report.stage).toBe("development");
    expect(report.enforced).toBe(false);
    expect(report.problems.length).toBeGreaterThan(0);
  });

  it("describes what was actually wired", () => {
    expect(describeEnvironment(wired())).toBe(
      "stage=preview firebase=it-smart-bloom-dev road-teacher=road-teacher-fafb1",
    );
  });
});
