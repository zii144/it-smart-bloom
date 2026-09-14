# 智晟｜綻放

「智晟｜綻放」以「路老師似顏繪」為核心體驗，是一套以 Next.js 與
OpenAI Image API 打造的相機到手機 AI 水彩人像服務。

## Experience

1. The booth opens the device camera and captures a square portrait.
2. The server creates a private, unguessable session that expires after 15 minutes.
3. The booth displays a QR code for the session.
4. Opening the QR link triggers one image-edit request.
5. The generated portrait appears on both the phone and booth screens.

The OpenAI key and image prompt are only read in server code. They are never
included in the browser bundle.

## Local setup

Copy the example environment file:

```bash
cp .env.example .env.local
```

Then set at least:

```dotenv
OPENAI_API_KEY=your_api_key
OPENAI_IMAGE_SYSTEM_PROMPT="Your image transformation instructions"
```

The remaining values in `.env.example` provide sensible defaults for model,
quality, output size, and the QR base URL.

### Firebase Emulator (local only)

`npm run dev` starts the Firestore + Storage emulators and Next.js together.
Development writes stay in the emulators and do not hit the live project.

```bash
npm run dev
```

- App: [http://localhost:3059](http://localhost:3059)
- Emulator UI: [http://127.0.0.1:4000](http://127.0.0.1:4000)

Use `npm run dev:next` only if you need Next without emulators.
Never set `FIRESTORE_EMULATOR_HOST` / `FIREBASE_STORAGE_EMULATOR_HOST` on Vercel.

### Road-teacher avatar (mock)

`NEXT_PUBLIC_RT_MOCK=true` (set in `.env.development.local`) simulates the
road-teacher sign-in and avatar replacement against the local
`/api/dev/set-avatar` stub, so the guest flow works end to end without the
road-teacher Firebase project. Any password of 6+ characters passes; `wrong`
fails; `locked@…` / `disabled@…` emails simulate lockout / disabled accounts.
See `docs/road-teacher-auth-plan.md` for the real integration.

### Admin dashboard (ops)

Hidden route: [http://localhost:3059/admin30910](http://localhost:3059/admin30910)

Set a server-only secret (required; the page 404s when unset):

```dotenv
ADMIN_DASHBOARD_SECRET=choose-a-long-random-string
```

Sign in with the password form, `?key=…` (exchanged for an httpOnly cookie), or HTTP Basic user `admin`. Shows Firebase/emulator health plus recent Firestore archive and local disk sessions.

The **批次生成** tab renders a stack of photos in one go, using
`OPENAI_IMAGE_SYSTEM_PROMPT` and the same model/quality/size defaults as the
booth.

### Guest identity (phone number)

The booth collects the guest's Taiwan mobile number (`09` + 8 digits) so a
finished portrait can be matched back to them later. Two rules hold everywhere:

- **It never leaves the server.** `publicSession` returns `identityClaimed: true`
  and nothing more, because `GET /api/sessions/[id]` is unauthenticated and its
  id is printed as a QR code on the booth screen. The admin dashboard shows a
  masked value (`0912***678`).
- **It is never a storage path.** The archive indexes identities under an HMAC
  of the number, not the number itself — a 10-digit key would make
  `identities/…` enumerable, and an unbounded one could exceed Firestore's
  1500-byte document-id limit.

```dotenv
IDENTITY_KEY_SECRET=choose-a-long-random-string
```

Required for the identity index; falls back to `ADMIN_DASHBOARD_SECRET`. With
neither set, portraits are still created and archived but the identity index is
skipped, and `POST /api/sessions` answers `identityStored: false` so the booth
can say so instead of implying the number was saved. **Rotating this secret
orphans every identity document already written** — treat it as permanent.

### Identity verification (name challenge)

A phone number is not taken on trust. Before a photo can be taken, the booth
proves the guest owns the number by asking a question only its owner can answer:

1. `POST /api/identity/challenge { mobile }` — Bloom asks road-teacher's
   `bloomIdentityChallenge` function for a line-up of names. RT returns five
   names plus a sealed `challengeId`; **the correct name never leaves RT in
   readable form**, so Bloom cannot turn a phone number into a teacher's name.
2. The booth shows the five names. `POST /api/identity/verify
   { mobile, challengeId, answer }` sends back the one the guest picked.
3. A correct pick returns a **signed identity token** (15-minute TTL) that the
   booth keeps in `localStorage` and posts as `identityToken` when creating the
   session. `POST /api/sessions` accepts nothing else — a raw `mobile` field is
   ignored, so an identity can only reach a session through a verification.

**Five wrong answers lock that number out for thirty minutes**
(`MAX_ATTEMPTS` / `LOCK_DURATION_MS` in `src/lib/identity-lockout.ts`). Attempts
are counted in a Firestore transaction so the limit holds across serverless
isolates, keyed by the HMAC of the number — a lockout document is not a list of
phone numbers. A correct answer clears the count; failures older than thirty
minutes stop counting, so an honest guest never accrues toward a lock.

Design notes worth knowing:

- **No enumeration.** An unregistered number gets a full five-name line-up too,
  so the response shape cannot be used to discover who is registered. Every
  option simply fails to verify.
- **No third-party PII.** Decoys are synthesised from common Taiwanese name
  parts, never drawn from other teachers' records, and match the real name's
  length with the surname often reused — so neither a failed attempt nor the
  shape of the line-up discloses anyone.
- **Fresh line-up per attempt.** A wrong answer fetches a new challenge. Re-using
  one line-up would let five attempts solve it by elimination.
- **Shared-booth safety.** The stored token is matched against the number the
  guest types, is cleared once a session is created and on 重新開始, and expires
  on its own — the next guest at the same booth cannot inherit it.

```dotenv
ROAD_TEACHER_IDENTITY_API_URL=https://<region>-<project>.cloudfunctions.net/bloomIdentityChallenge
ROAD_TEACHER_API_KEY=shared-with-the-road-teacher-function
```

Residual risk, stated plainly: with five options and five attempts, a blind
guesser who already knows a target's phone number has roughly a 1 − (4/5)⁵ ≈ 67%
chance within one thirty-minute window. This is knowledge-based verification, not
possession proof — it is deliberately the "soft" option. Raising the option count
(`optionCount` on the challenge call) or escalating repeat lockouts are the two
levers if that number needs to come down; an SMS one-time code is the fix if it
needs to be strong.

### API error codes

Every JSON error carries a stable `code` next to the human `error` message, so
clients branch on the code and the wording stays free to change:

```json
{ "error": "請輸入台灣手機號碼，例如 0912345678。", "code": "IDENTITY_INVALID" }
```

`IMAGE_REQUIRED` · `IMAGE_INVALID` · `IMAGE_TOO_LARGE` · `IMAGE_TYPE_UNSUPPORTED`
· `IMAGE_OPTIONS_INVALID` · `IMAGE_KIND_INVALID` · `IDENTITY_REQUIRED` ·
`IDENTITY_INVALID` · `IDENTITY_TOO_LONG` · `IDENTITY_LOCKED` (423) ·
`IDENTITY_ANSWER_WRONG` · `IDENTITY_CHALLENGE_EXPIRED` (410) ·
`IDENTITY_TOKEN_INVALID` · `IDENTITY_SERVICE_UNAVAILABLE` (502) ·
`SESSION_NOT_FOUND` ·
`SOURCE_PHOTO_NOT_FOUND` · `PORTRAIT_NOT_FOUND` · `PORTRAIT_NOT_READY` ·
`IDENTITY_KEY_UNAVAILABLE` · `ARCHIVE_UNAVAILABLE` · `GENERATION_FAILED` ·
`INTERNAL_ERROR`

Codes are append-only; see `src/lib/api-errors.ts`.

### Daily spend ceiling

Every guard in the batch panel is client-side. These env vars are the
server-side one, checked before each OpenAI call and counted in Firestore
(`usage/YYYY-MM-DD`, Taiwan time). All are optional; unset means no ceiling.

```dotenv
IMAGE_DAILY_LIMIT=200            # images per day
IMAGE_DAILY_BUDGET_USD=40        # needs IMAGE_UNIT_COST_USD to mean anything
IMAGE_UNIT_COST_USD=0.19         # or a table: {"low":…,"medium":…,"default":…}
IMAGE_SPEND_ENFORCE=batch        # batch (default) | all — `all` also gates guests
```

Costs are estimates from prices you supply; this project ships no rate card.
`IMAGE_SPEND_ENFORCE=batch` deliberately spares walk-up guests, so a blown
budget never turns a live booth away — set `all` when the ceiling must be
absolute. Renders are counted on attempt, so a failed call still counts.

## Testing QR codes on another device

A phone cannot reach `localhost` on the booth computer. Either:

- open the booth using the computer's LAN address, such as
  `http://192.168.1.20:3059`; or
- set `APP_BASE_URL` to an HTTPS tunnel or deployed application URL.

Camera access generally requires HTTPS, except on `localhost`. For physical
device testing, an HTTPS URL is recommended.

## Storage and deployment

Local development stores source and generated images under `.data/sessions`
(or `BLOOM_DATA_DIR`). On Vercel the writable root is `/tmp/bloom-sessions`.

Because serverless isolates do not share `/tmp`, production also mirrors each
session into Firestore + Firebase Storage **before** returning the booth QR
response. Phone polls and image fetches fall back to that archive when the
local disk copy is missing.

## Validation

```bash
npm run lint
npx tsc --noEmit
npm run build
```
