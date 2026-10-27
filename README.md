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

Sign in with the password form (POST) or HTTP Basic user `admin`. Query-string
`?key=` login is not supported. Shows Firebase/emulator health plus recent
Firestore archive and local disk sessions.

The **批次生成** tab renders a stack of photos in one go, using
`OPENAI_IMAGE_SYSTEM_PROMPT` and the same model/quality/size defaults as the
booth.

### Guest roster (名單)

Only guests on the roster can create a portrait. The booth asks for 姓名 +
手機, and both must match one entry in the Firestore `roster` collection.
`POST /api/roster/verify` gives the guest an early answer.
`POST /api/sessions` checks again on the server and stores only the matched
`rosterEntryId` on the session, never the name or phone. If Firestore is
unreachable, the booth fails closed with a 503.

Manage the roster in the admin dashboard's **名單管理** tab:

- **Import from Excel (.xlsx).** The first sheet with both 姓名 and 手機
  columns is used. The importer shows a preview (new / updated / unchanged /
  rows to check) before anything is written. Imports only add and update:
  nobody is deleted, and blank cells never erase existing values. Phone
  numbers like `0912-345-678`, `+886 912…`, or a number cell that lost its
  leading 0 are normalized to `09xxxxxxxx`. The same person listed twice is
  merged. Legacy `.xls` files must be re-saved as `.xlsx`.
- **Columns.** 座位, 標籤, 身分, 電子郵件, 地址, 公文, 備註, 背心, 飯友,
  導師補助 and 團隊貴賓 are kept for admin use. Unknown columns are kept as
  extra fields. 身分證正面/反面 and 存摺 are never imported.
- **Edit, add or delete people.** People without a valid mobile are imported
  but cannot match until a mobile is filled in (filter: 只看無手機). Two
  entries cannot share the same 姓名 + 手機.

Failed guest lookups are rate-limited per server instance: 8 wrong phone
numbers per name per client in 10 minutes. There is also a 200-failure
ceiling per client, kept high because every guest at the booth shares one
network address.

### Booth photo

Guests upload a photo after entering 姓名 + 手機. The on-site camera
option (改用現場相機) is off. A staffed kiosk can turn it back on with
`<CameraBooth cameraOption />`.

### One photo per guest

Each roster guest can submit **one** photo; that is one portrait generation.

- The booth's early check (`POST /api/roster/verify`) answers **409** for a
  guest who already submitted, so they are told before picking a photo.
  `POST /api/sessions` enforces it too, with a Firestore transaction, so
  two phones submitting at once cannot both get through.
- **Only finished portraits count.** If the photo cannot be stored, or the
  portrait fails to generate (e.g. an OpenAI error), the guest gets their
  submission back automatically. A failed render that later succeeds on
  retry uses it again.
- Admins can lift the limit for one guest in **報到管理** → **允許重新上傳**
  (two-step). The guest's current portrait stays until the new one replaces
  it.
- Guests who made a portrait before this rule count as already submitted,
  unless that portrait failed.
- Resetting **似顏繪** in 資料重置 lets everyone submit again.
- Stored as `photoSubmittedAt` on the roster entry. Imports and admin edits
  never touch it.

### Success card (`/success/[id]`)

After a guest confirms their photo, the booth goes to `/success/[session]`.
This is an invitation-style card that greets the guest by roster name,
confirms the photo was received, and shows their 座位 and the event details.
Its QR code (and a tappable link) always opens the event rundown on Google
Drive (`EVENT_RUNDOWN_URL` in `src/lib/event-info.ts`). **The portrait is not
handed out here.** A missing or expired session gets a friendly card instead
of an error.

### Event-day check-in (`/check-in`)

Guests check in on their own phone (put a QR to `/check-in` at the
entrance) with the same 姓名 + 手機 match as the booth. They get a joyful
報到成功 card with their seat. Checking in again shows the original time.

- **Portrait handover.** A valid check-in is what earns the portrait. If it
  is finished, the card shows it with a 儲存作品 download, served by
  `GET /api/check-in/portrait/[token]`. The token is random, stored on the
  roster entry, and valid for 7 days. It is replaced on each check-in and
  revoked when staff undo the check-in. This works long after the session's
  15-minute link has expired; the image comes from Firebase Storage. A
  portrait still being painted shows 再看一次, which re-checks without
  retyping.
- Check-in is closed until an admin turns it on in **報到管理** (stored in
  `rosterMeta/checkIn`). While closed, the page shows the event details.
- The **報到管理** tab shows arrivals vs total and the arrival rate, filters
  (全部 / 已報到 / 未報到), search, manual check-in and two-step undo, each
  guest's portrait status, and a CSV export (UTF-8 with BOM, safe from
  spreadsheet formulas). It refreshes every 10 seconds while the tab is open
  and the window is visible. Staff never receive guests' portrait tokens.
- Arrival (`checkedInAt`, `checkInSource`), the latest portrait
  (`portraitStatus`) and the portrait token are stored on the guest's
  `roster` entry. Imports and admin edits never overwrite them.

### Data reset (資料重置)

The admin dashboard's **資料重置** tab clears data by category:

| Category | Clears | Keeps |
|---|---|---|
| 名單 | every roster entry, the last-import record | portraits, usage |
| 報到紀錄 | arrival times and sources, portrait links | guests, portraits |
| 似顏繪 | `sessions` and `identities` docs, `sessions/` and `identities/` in Storage, local copies, each guest's portrait status | guests, arrivals |
| 用量統計 | the `usage` daily counters | everything else |

Safeguards:
- **Backup first.** The browser first downloads a JSON backup of everything
  the reset will change. If the backup fails, nothing is reset. Storage
  photos are not in the backup.
- **Typed confirmation.** The admin must type 「確認重置」, and the server
  checks it too.
- **Clear environment label.** The tab shows whether it is connected to
  **正式環境** (live) or the emulator. It works in production.
- **Logged.** Every reset is recorded in `adminLog` (time, categories,
  counts, environment); no reset ever deletes that log.
- Resetting 名單 or 報到紀錄 also closes check-in.

Store and flow integration tests run against dedicated emulators (Firestore
8181, Storage 9299), so they never touch the dev emulator's data:

```bash
npm run test:emulator
```

### Session guest access

Guest session URLs expire after 15 minutes (`expiresAt`). Status, image, and
generate routes return `410` afterwards. Each booth session may start at most
two generations (first render + one retry). Local expired directories are purged
opportunistically when new sessions are created; Firebase archive retention is
separate.

Road-teacher avatar replacement UI is shown only when `NEXT_PUBLIC_RT_MOCK=true`
(dev). Legacy LINE/mobile claim endpoints stay off unless
`ALLOW_LEGACY_IDENTITY_CLAIM=true`.

### Daily spend ceiling

Every guard in the batch panel is client-side. These env vars are the
server-side one: generation atomically reserves a slot in Firestore
(`usage/YYYY-MM-DD`, Taiwan time) before calling OpenAI. All are optional;
unset means no ceiling.

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
