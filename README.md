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

### Road-teacher avatar

The booth asks each guest for their 姓名 and 手機號碼. On the result page,
一鍵替換成路老師系統大頭貼 posts to `/api/sessions/[id]/avatar`, and this
server sends the portrait with that name and mobile to road-teacher's
`bloomSetAvatarByIdentity` function. Road-teacher sets it as the avatar of
the one teacher whose `displayName` and `mobile` both match. The contract is
in road-teacher's `docs/BLOOM_IDENTITY_AVATAR.md`.

```dotenv
ROAD_TEACHER_AVATAR_API_URL=https://us-central1-<project>.cloudfunctions.net/bloomSetAvatarByIdentity
ROAD_TEACHER_AVATAR_API_KEY=<same value as BLOOM_AVATAR_API_KEY on road-teacher>
```

`NEXT_PUBLIC_RT_MOCK=true` (set in `.env.development.local`) skips the call
and reports a simulated success. It only takes effect in dev and preview
builds, never in production.

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
