# 路老師大頭貼替換 — Firebase Auth 改造計畫

Replace the unauthenticated LINE ID / mobile identity claim with a real
Firebase Auth sign-in against the road-teacher (RT) project, and move avatar
replacement into an RT-owned Cloud Function.

**Status:** frontend layer shipped with a mocked flow (2026-07-30) — login
sheet, client auth/orchestration modules (`road-teacher-auth.ts`,
`road-teacher-client.ts`, `road-teacher-login-modal.tsx`), and the
`/api/dev/set-avatar` stub, gated by `NEXT_PUBLIC_RT_MOCK` (dev builds only).
Backend phases (portrait tickets, avatar-result route, identity deletion) and
the real RT Firebase sign-in are still pending.
The RT-side function is **implemented** (2026-07-30, uncommitted in the RT
repo) as `bloomSetAvatar` — `functions/src/bloom-set-avatar{,-core}.ts`, 77
unit tests, region `us-central1`; as-built contract in the RT repo's
`docs/BLOOM_AVATAR_BRIDGE.md`, which supersedes §6 below where they differ
(it adds 403 `Not a road teacher` / `Account disabled` and a 5/hour rate
limit).
**Owner:** Bloom side in this repo; `bloomSetAvatar` function in the RT repo

---

## 1. Why

### The hole we are closing

`POST /api/sessions/[id]/claim` accepts any string matching `^\d+-.+-.+$`
([guest-identity.ts:6](../src/lib/guest-identity.ts)) or any `09xxxxxxxx`
mobile, and the server then forwards the finished portrait to the RT system
keyed on that value ([avatar/route.ts:38](../src/app/api/sessions/[id]/avatar/route.ts)).

Nothing proves the guest owns the identifier. Anyone who can reach a session
URL can type a stranger's LINE ID and overwrite that person's avatar. This is
a missing-authorization bug, not a hardening opportunity.

### Secondary wins

- **PII removal.** Mobile numbers are currently written to Firestore
  (`identityValue`) and baked into Storage object paths via
  `identityStorageKey` ([portrait-archive.ts:130](../src/lib/portrait-archive.ts)).
  After this change Bloom stores no phone numbers and no cross-system
  identifiers at all.
- **No shared secret.** `ROAD_TEACHER_AVATAR_API_KEY` disappears. Authorization
  becomes a per-guest, 1-hour, RT-issued ID token instead of a static bearer
  key held by this app.
- **Unblocks the feature.** `ROAD_TEACHER_AVATAR_API_URL` was never configured
  (commented out in `.env.local`, absent from `.env.production.local`), so the
  avatar button currently 502s in every environment.

---

## 2. Target architecture

```
1. Booth capture → session → QR                            (unchanged)
2. Phone /s/[id] → generate → portrait complete            (unchanged)
3. Guest taps 設為路老師大頭貼 → login sheet opens
4. signInWithEmailAndPassword against RT's Firebase project  browser → Google
5. getIdToken()
6. POST /api/sessions/[id]/portrait-token → { url }          single-use, 5 min
7. POST <RT setAvatar>  Bearer <idToken>  { portraitUrl }    phone → RT direct
8. RT: verifyIdToken → fetch url → validate → write avatar
9. POST /api/sessions/[id]/avatar-result                     advisory only
```

### Trust boundaries

| Secret | Who sees it |
|---|---|
| RT password | Browser → Google identitytoolkit over TLS. **Never** reaches the Bloom server. |
| RT ID token | Browser → RT function. **Never** reaches the Bloom server. |
| RT uid | Derived by RT from `verifyIdToken`. Never sent by the client, never stored by Bloom. |
| Portrait bytes | Bloom → RT server-to-server, via a single-use 5-minute ticket. |

Bloom and RT share **no static credential** after this change.

### Why the phone calls RT directly

Proxying the ID token through `/api/sessions/[id]/avatar` would put another
system's credential in this app's request path and logs. Calling RT directly
keeps the blast radius of a Bloom compromise to Bloom.

### Why a ticket instead of raw bytes

The phone's upload stays tiny (one JSON POST) rather than re-uploading a
~1 MB portrait over mobile data. The ticket grants strictly *less* than the
session id already does — the existing
[`/api/sessions/[id]/image`](../src/app/api/sessions/[id]/image/route.ts) route
already serves the portrait to any holder of the id — and adds single-use plus
a 5-minute expiry on top.

### Residual risk (accepted)

The password form is served from `it-smart-bloom.vercel.app`, a different
origin from the RT system. This is the phishing-training pattern: guests learn
that typing RT credentials into an unfamiliar domain is normal. Mitigations
built into this plan:

- All password handling is confined to a single module
  (`src/lib/road-teacher-auth.ts`) so swapping to an RT-hosted redirect flow,
  LINE Login, or email-link sign-in later touches exactly one file.
- `inMemoryPersistence` + explicit `signOut` so no RT session survives on the
  handset.
- The sign-in is never a gate — portrait, share and download stay anonymous.

If RT can host a sign-in page on their own domain, prefer that; it is a
drop-in replacement for Phase 2 only.

---

## 3. Scope

**In scope (this repo)**
- Client-side RT sign-in module
- Single-use portrait ticket mint/redeem
- Phone UI: replace identity form with login sheet
- Delete the identity subsystem end-to-end
- Admin dashboard column update
- Test suite updates

**In scope (RT repo — spec only, §6)**
- `setAvatar` HTTPS function

**Out of scope**
- Booth capture, camera, OpenAI generation — untouched
- Share buttons (LINE / Facebook) — untouched
- Deleting existing `identities/**` PII — see Phase 6, requires sign-off

---

## 4. Phases

### Phase 0 — Prerequisites (blocking, RT team)

- [ ] Confirm the RT Firebase **project id**, **web API key**, **auth domain**
- [ ] Confirm email/password provider is enabled for the accounts that will use the booth
- [ ] Add `it-smart-bloom.vercel.app` (and the LAN dev origin) to RT's
      **Authorized domains** in Firebase Auth settings
- [ ] Agree the `setAvatar` function region + URL
- [ ] Decide whether RT enables App Check on the function

Nothing else can ship without these.

---

### Phase 1 — Portrait ticket infrastructure

**New — `src/lib/portrait-token.ts`**

```ts
import { randomBytes } from "node:crypto";

const TTL_MS = 5 * 60_000;

export type PortraitTicket = {
  token: string;      // randomBytes(32).toString("base64url")
  sessionId: string;
  expiresAt: string;
  redeemedAt: string | null;
};

export async function mintPortraitTicket(sessionId: string): Promise<PortraitTicket>;

/** Runs in a Firestore transaction so a replayed token loses the race. */
export async function redeemPortraitTicket(token: string): Promise<string>;
```

**Must be Firestore-backed, not an in-memory `Map`.** Vercel isolates do not
share memory — this is the same trap fixed in `8a73093` for session storage.
Use a `portraitTickets` collection. `firestore.rules` needs no change: it
already denies all client access and every write here goes through the Admin
SDK.

Redeem semantics: reject if missing, expired, or `redeemedAt !== null`; set
`redeemedAt` inside the transaction before returning.

**New — `src/app/api/sessions/[id]/portrait-token/route.ts`**

```ts
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await getSession(id);
    if (session.status !== "complete") {
      return Response.json({ error: "人像尚未完成，請稍候再試。" }, { status: 409 });
    }
    const ticket = await mintPortraitTicket(id);
    return Response.json(
      { url: `${appBaseUrl()}/api/portrait/${ticket.token}`, expiresAt: ticket.expiresAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SessionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to mint portrait ticket:", error);
    return Response.json({ error: "無法建立圖片連結。" }, { status: 500 });
  }
}
```

**New — `src/app/api/portrait/[token]/route.ts`**

`GET`, redeems the ticket, streams the result image. Server-to-server from RT,
so no CORS handling needed. Reuse the response headers from
[image/route.ts:27](../src/app/api/sessions/[id]/image/route.ts) —
`Content-Type`, `Content-Length`, `Cache-Control: private, no-store`,
`X-Content-Type-Options: nosniff`. Return `404` for missing/expired/redeemed
tokens with a generic body (no oracle on which case it was).

---

### Phase 2 — RT client auth module

**Add dependency:** `npm i firebase` (modular SDK; only `firebase/app` and
`firebase/auth` are imported, so the bundle cost stays contained).

**New — `src/lib/road-teacher-auth.ts`** — the only file in this repo that
ever touches a password.

```ts
"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth, inMemoryPersistence, setPersistence,
  signInWithEmailAndPassword, signOut, type Auth,
} from "firebase/auth";

const APP_NAME = "road-teacher";

// RT's *public* web config. Safe in the bundle — it identifies the project,
// it does not authorize anything. Access is decided by verifyIdToken in the
// RT function. Kept separate from firebase-public-config.ts, which describes
// the Bloom project and is not used for auth.
const config = {
  apiKey: process.env.NEXT_PUBLIC_RT_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_RT_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_RT_FIREBASE_PROJECT_ID!,
};

function rtAuth(): Auth {
  const app = getApps().some((a) => a.name === APP_NAME)
    ? getApp(APP_NAME)
    : initializeApp(config, APP_NAME);
  return getAuth(app);
}

export async function signInToRoadTeacher(email: string, password: string) {
  const auth = rtAuth();
  // Never persist to IndexedDB: a booth handset must not leak a live RT
  // session to the next guest.
  await setPersistence(auth, inMemoryPersistence);
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user.getIdToken();
}

export async function forgetRoadTeacherSession() {
  await signOut(rtAuth()).catch(() => {});
}
```

**New — `authErrorMessage(error)` helper** (same file or a sibling). The whole
UI is Chinese-facing, so map Firebase codes rather than surfacing raw strings:

| code | message |
|---|---|
| `auth/invalid-credential`, `auth/wrong-password`, `auth/user-not-found` | 帳號或密碼不正確。 |
| `auth/too-many-requests` | 嘗試次數過多，請稍後再試。 |
| `auth/user-disabled` | 此帳號已停用，請聯絡路老師系統管理員。 |
| `auth/network-request-failed` | 網路連線不穩，請稍後再試。 |
| *(fallback)* | 登入失敗，請稍後再試。 |

Deliberately collapse `user-not-found` into the same message as a wrong
password so the form is not an account-enumeration oracle.

---

### Phase 3 — Phone UI

**Rewrite — [session-experience.tsx](../src/components/session-experience.tsx)**

Remove the identity form (lines ~508–566) and the `identity` field on the
`SessionStatus` type (line ~34). Replace `claimIdentity()` (line ~380) and the
existing `requestAvatar()` (line ~403) with a single flow:

```ts
async function requestAvatar(email: string, password: string) {
  setAvatarBusy(true);
  setAvatarMessage(null);
  try {
    const idToken = await signInToRoadTeacher(email, password);
    try {
      const ticket = await fetch(`/api/sessions/${id}/portrait-token`, { method: "POST" })
        .then((r) => r.json());
      const response = await fetch(process.env.NEXT_PUBLIC_RT_SET_AVATAR_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ portraitUrl: ticket.url, sessionId: id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "路老師系統暫時無法使用。");
      setAvatarMessage("已更新路老師系統大頭貼。");
      void fetch(`/api/sessions/${id}/avatar-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true }),
      });
    } finally {
      await forgetRoadTeacherSession();   // drop the session even on failure
    }
  } catch (caught) {
    setAvatarMessage(authErrorMessage(caught));
  } finally {
    setAvatarBusy(false);
  }
}
```

UX rules:

- The login sheet opens **only** on tapping 設為路老師大頭貼. Portrait, share
  and download remain anonymous — auth is never a gate on seeing the result.
- Form fields: `type="email"` + `autoComplete="username"`,
  `type="password"` + `autoComplete="current-password"`, so password managers
  work and reduce typed-password exposure.
- Show the RT domain in the sheet header so guests can see whose credentials
  are being asked for.

**New — `src/app/api/sessions/[id]/avatar-result/route.ts`**

Accepts `{ ok: true }` or `{ ok: false, error: string }` and calls the existing
`markAvatarRequest` ([portrait-archive.ts:223](../src/lib/portrait-archive.ts)).

> **This endpoint is client-reported and therefore forgeable. It is ops
> bookkeeping for the dashboard only and must never be treated as a security
> control or as proof the avatar changed.** Document this in the file header.

Store `avatarRequestedAt` / `avatarRequestStatus` / `avatarRequestError` only —
**do not store the RT uid**, or the cross-system identifier we just removed
comes straight back into the archive.

---

### Phase 4 — Delete the identity subsystem

**Delete**
- `src/lib/guest-identity.ts`
- `src/app/api/sessions/[id]/claim/route.ts`
- `src/lib/road-teacher-avatar.ts` (server-to-server call is gone)
- `src/app/api/sessions/[id]/avatar/route.ts` (replaced by `avatar-result`)
- `tests/guest-identity.test.ts`

**Modify — [src/lib/sessions.ts](../src/lib/sessions.ts)**
- Drop `identity?` from `ImageSession` (line ~36)
- Drop `identityKind` / `identityValue` from the record type (lines ~112–113)
- Drop the rehydration block (lines ~134–138)
- Drop the `identity` projection in `publicSession` (lines ~460–465)

**Modify — [src/lib/portrait-archive.ts](../src/lib/portrait-archive.ts)**
- `ArchiveRecord`: remove `identityKind`, `identityValue`, `identityKey`,
  `claimedAt`, and `storage.identityInputPath` / `storage.identityResultPath`
  (lines 17–20, 27–28)
- Delete `identityDoc()` (line 38) and `claimSessionIdentity()` (line 157)
- Remove the `identities/**` upload branch in `archiveSessionStatus`
  (lines 128–134)
- Keep `markAvatarRequest` as-is

**Modify — `.env.local`** — delete the commented `ROAD_TEACHER_AVATAR_API_URL`
and `ROAD_TEACHER_AVATAR_API_KEY` lines.

---

### Phase 5 — Admin dashboard

**Modify — [src/app/api/admin30910/route.ts](../src/app/api/admin30910/route.ts)**
- Line ~58: local sessions no longer have `session.identity` → drop the field
- Lines ~75–79: archive rows no longer have `identityKind`/`identityValue` →
  drop, keep `avatarRequestStatus`

**Modify — [src/components/admin-dashboard.tsx](../src/components/admin-dashboard.tsx)**
- Remove `identity` from the row type (line 11) and `localizeIdentity` (line 80)
- Replace the identity cell (line 224) with the avatar-request status alone

The dashboard loses the "who claimed it" column by design — that information
now lives only in the RT system, which is the point.

---

### Phase 6 — Existing PII cleanup ⚠️ **requires explicit sign-off**

Prior runs left real mobile numbers in:
- Firestore `identities/` documents (`kind`, `value`, `sessionIds`)
- Firestore `sessions/*` fields `identityKind`, `identityValue`, `identityKey`
- Storage objects under `identities/**`

The schema change **orphans** this data but does not remove it.

Before writing any deletion script:
1. Confirm nothing downstream reads `identities/` (RT system, exports, reports)
2. Confirm retention/consent obligations for the numbers already collected
3. Get explicit written go-ahead

Then a one-off script (`scripts/purge-identities.cjs`) with a `--dry-run`
default that lists counts and paths before touching anything.

---

## 5. Environment and dependencies

**New dependency:** `firebase` (client SDK)

**New public vars** (all four are safe in the browser bundle):

```dotenv
NEXT_PUBLIC_RT_FIREBASE_API_KEY=
NEXT_PUBLIC_RT_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_RT_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_RT_SET_AVATAR_URL=https://<region>-<rt-project>.cloudfunctions.net/setAvatar
```

**Removed:** `ROAD_TEACHER_AVATAR_API_URL`, `ROAD_TEACHER_AVATAR_API_KEY`

**Local dev.** RT's function will not exist locally. Mirror the `fakeGenerate`
pattern: point `NEXT_PUBLIC_RT_SET_AVATAR_URL` at a stub route
`/api/dev/set-avatar` gated by `isImageTuningEnabled()`
([runtime-env.ts](../src/lib/runtime-env.ts)) that validates the ticket, fetches
the portrait, and returns `{ ok: true }` without writing anything. For sign-in,
either point at an RT staging project or run the Firebase Auth emulator with
seeded users behind a `NEXT_PUBLIC_RT_AUTH_EMULATOR_HOST` guard.

---

## 6. RT function contract (spec for the RT repo)

```
POST https://<region>-<rt-project>.cloudfunctions.net/setAvatar
Authorization: Bearer <Firebase ID token, RT project>
Content-Type: application/json

{ "portraitUrl": "https://it-smart-bloom.vercel.app/api/portrait/<token>",
  "sessionId": "<bloom session id, for correlation only — never trusted>" }

200 { "ok": true }
401 { "error": "Missing token" | "Invalid token" }
400 { "error": "Bad portraitUrl" | "Untrusted portrait host" }
413 { "error": "Portrait too large" }
415 { "error": "Unsupported image type" }
429 { "error": "Too many requests" }
502 { "error": "Portrait fetch failed" }
```

```ts
export const setAvatar = onRequest(
  { cors: ["https://it-smart-bloom.vercel.app"], region: "asia-east1" },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const header = req.get("Authorization") ?? "";
    const raw = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!raw) return res.status(401).json({ error: "Missing token" });

    let uid: string;
    try {
      // checkRevoked=true: a disabled account must not be able to write an avatar.
      ({ uid } = await getAuth().verifyIdToken(raw, true));
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }

    // SSRF guard — this function fetches a client-supplied URL, so pin the host
    // and refuse redirects. Without this it is a pivot into GCP metadata.
    let url: URL;
    try { url = new URL(req.body?.portraitUrl); }
    catch { return res.status(400).json({ error: "Bad portraitUrl" }); }
    if (url.protocol !== "https:" || url.hostname !== PORTRAIT_HOST) {
      return res.status(400).json({ error: "Untrusted portrait host" });
    }

    const upstream = await fetch(url, { redirect: "error" });
    if (!upstream.ok) return res.status(502).json({ error: "Portrait fetch failed" });

    const mime = upstream.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!ALLOWED_MIME.has(mime)) return res.status(415).json({ error: "Unsupported image type" });

    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return res.status(413).json({ error: "Portrait too large" });

    await writeAvatar(uid, bytes, mime);
    return res.json({ ok: true });
  },
);
```

Non-negotiable on the RT side:

1. **`redirect: "error"` + host pin.** A function that fetches arbitrary
   client-supplied URLs is a direct SSRF path into GCP metadata.
2. **Size and MIME ceilings** (suggest 8 MB, `image/jpeg|png|webp`).
3. **Per-uid rate limit** so one account cannot spam replacements.
4. **`uid` comes only from `verifyIdToken`** — `sessionId` in the body is
   correlation metadata and must never influence which account is written.

App Check on the function is recommended if RT will take it.

---

## 7. Test plan

Baseline before starting: **203 tests / 18 files passing**.

**New**
| File | Covers |
|---|---|
| `tests/portrait-token.test.ts` | mint shape; redeem once succeeds; second redeem rejects; expired rejects; unknown token rejects |
| `tests/api-portrait-token.test.ts` | 409 when session incomplete; 404 for unknown session; URL shape; `no-store` |
| `tests/api-portrait-serve.test.ts` | streams bytes + headers on first call; 404 on replay |
| `tests/road-teacher-auth.test.ts` | `inMemoryPersistence` set before sign-in; named app reused not re-initialized; `authErrorMessage` mapping incl. enumeration collapse |

**Rewritten**
- `tests/api-claim-avatar.test.ts` → `tests/api-avatar-result.test.ts`; drop
  the two claim cases, keep bookkeeping assertions
- `tests/session-experience.test.tsx` — login sheet renders on tap only;
  portrait/share visible without auth; `signOut` called on both success and
  failure paths; RT fetch receives the Bearer header

**Updated**
- `tests/api-admin30910.test.ts` — identity column gone
- `tests/sessions.test.ts` — `identity` removed from the session shape

**Deleted**
- `tests/guest-identity.test.ts`

**Gate:** `npm run lint && npx tsc --noEmit && npm test && npm run build`

---

## 8. Rollout

1. Phase 0 complete (RT config in hand)
2. Phases 1–5 land behind the existing `isImageTuningEnabled()` gate for the
   dev stub; production points at the real RT function
3. Manual verification on a real handset over the LAN URL:
   - portrait completes and shares work **without** signing in
   - wrong password → 帳號或密碼不正確
   - correct password → avatar visible in the RT system
   - replaying the same portrait URL → 404
   - reload the page → not still signed in
4. Deploy to Vercel with the four `NEXT_PUBLIC_RT_*` vars set
5. Phase 6 only after sign-off

**Rollback:** the change is additive on the RT side and the Bloom side is a
single deploy. Reverting the Bloom commit restores the previous behaviour, which
was already non-functional in production (`ROAD_TEACHER_AVATAR_API_URL` unset) —
so rollback risk is effectively zero.

---

## 9. Open questions

1. ~~**Function region and URL**~~ **Resolved 2026-07-30:** `us-central1`,
   function name `bloomSetAvatar`. `NEXT_PUBLIC_RT_SET_AVATAR_URL` is
   `https://us-central1-road-teacher-fafb1.cloudfunctions.net/bloomSetAvatar`
   (dev) / `https://us-central1-road-teacher-prod.cloudfunctions.net/bloomSetAvatar`
   (prod).
2. **Bytes vs. ticket** — does RT prefer a direct multipart upload from the
   phone instead of fetching a URL? Simpler for them, heavier for the handset.
3. **Can RT host the sign-in page?** If yes, Phase 2 becomes a redirect flow
   and the phishing-pattern risk in §2 disappears entirely. Worth asking before
   building.
4. **Dev sign-in** — RT staging project, or Auth emulator with seeded users?
5. **Phase 6 retention** — who owns the decision on deleting collected mobile
   numbers?
