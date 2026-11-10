# Seat-status display

`/seat-status` is a read-only attendance display for landscape (16:9) and
portrait (9:16) screens. It shows the venue floor plan and seat check-in status.
The **看板資訊** panel contains arrival totals, waiting guests and arrival
percentage. Hovering, tapping or focusing a seat opens a guest card with name,
role and check-in status. Phone numbers and portrait links are never sent.
Check-in does not establish physical seat occupancy.

## Using the display

Open `/seat-status`, or use **報到管理 → 開啟即時座位看板**. Staff authorize
the screen with the existing `ADMIN_DASHBOARD_SECRET`. An already signed-in
admin is authorized automatically. The resulting display session is read-only
and expires after 12 hours; it cannot authorize admin API calls. Renewing the
Firebase token never extends this deadline. A reload keeps the display session.

The sign-in screen also offers **先預覽看板版面**. This creates clearly
labelled demonstration seats in browser memory, without reading or writing
event data. Open **看板資訊 → 返回即時看板** to leave preview mode.
`/seat-status?preview=1` opens the same labelled preview directly without
authorization. Its fictional arrivals reproduce the reference's peach N/O rows.

The floor plan uses the supplied 418 × 745 reference coordinates: a stage,
two VIP rows, A–O rows of twelve seats in three blocks of four, cross aisles
after C and J, the left wall and door, tea area, two check-in stations, and
N/O reserve rows. SVG scales the complete layout uniformly; seat positions
never paginate. White/pale-green alternating rows are
venue styling; checked-in seats use #F8DDD3 plus a small check mark.
**16:9 版面** in the toolbar (or `/seat-status?layout=16x9`, combinable with
`preview=1`) switches to a full-screen landscape drawing. The
plan is re-flowed into a 1600 × 900 drawing — same order, blocks, aisles and
venue markers, stage still on top — with 96 × 36 seats so labels stay legible
where the portrait drawing would shrink to a narrow strip. Only the map and the toolbar are shown; totals stay
in **看板資訊**. The toggle rewrites the address
so a reload keeps the layout. Motion is limited to a short staggered seat
fade-in, a drawn check mark and colour fade on arrival, and a breathing
connection dot; all of it is disabled under `prefers-reduced-motion`.

The page has a warm cream/sage/peach backdrop and a persistent legend below
the plan. Unassigned seats use a neutral dashed outline; duplicate assignments
use an amber warning fill and border. VIP brick red is a venue marker, not an
arrival state. Labels and symbols accompany each color.

Guest cards remain open while the pointer is over the seat or card. Escape,
the close button, or tapping outside dismisses them. Unassigned seats show an
empty message; conflicting seats list their assigned guests. Preview cards use
fictional names and never request real guest information.

All 180 physical A–O seats remain visible even when not yet assigned. Duplicate
assignments receive a warning border. Unassigned guests and roster seats outside
the venue plan remain in attendance totals; out-of-plan labels are listed in
**看板資訊** for staff to reconcile. VIP tiles preserve the reference's lettering
as venue markers; roster-to-VIP identifiers have not been provided, so no VIP
check-in mapping is inferred.

## Pipeline

The private `roster/{id}` document remains authoritative. Each relevant
mutation writes a minimal `seatStatus/{id}` document in the same Firestore
transaction or batch:

```json
{ "seat": "A1", "checkedInAt": "2026-11-10T05:00:00.000Z" }
```

Unarrived guests have `checkedInAt: null`. Document ids are roster ids, so
duplicate seat labels cannot silently overwrite one another. Creation, editing,
import, check-in, undo, deletion, and event resets maintain this projection.
Import transactions re-read arrival state to preserve concurrent check-ins.
Portrait-only changes and repeat check-ins do not publish arrival updates.

`seatStatusMeta/checkIn` mirrors the open/closed switch. Counts are derived
from the same seat-entry snapshot as the board. The switch has a separate
listener; it may arrive just before or after seat changes, without affecting
attendance totals.

First authorization backfills existing roster records and removes orphaned
display records. The rebuild re-reads each guest inside a transaction, so it
cannot overwrite a concurrent check-in with stale migration data. A schema
marker prevents a complete roster scan on each later authorization.

For repair, an authenticated admin can POST
`/api/admin30910/seat-status/rebuild` (cookie or Basic auth). It is safe to
repeat while arrivals continue. Display sessions cannot invoke it. Backups
continue to store the authoritative roster; the derived display can be rebuilt.
Console edits or external import scripts must use the application data layer
or run this repair afterward.

## Live delivery and failure behavior

The server exchanges staff authorization for a Firebase custom token scoped
to the display, with the original fixed session deadline in its claims. The
client uses a separately named Firebase app and memory-only Firebase Auth
persistence, leaving Road Teacher authentication independent.

Two `onSnapshot` listeners read the seat collection and check-in switch. Only
server-confirmed snapshots mark the screen live. Cached snapshots never replace
the last confirmed board. If live setup fails or disconnects, the browser polls
`GET /api/seat-status` every five seconds and retries the live connection every
30 seconds. Polling reads the same minimal collection, not the private roster.
Requests time out, listeners and timers are disposed on unmount, and late
responses are ignored. An outage retains the previous map with an offline
indicator. Expiry prompts for staff authorization again.

Guest details are loaded separately, after a 150 ms hover delay, from
`GET /api/seat-status/guests?seat=A1&ids=...`. This endpoint requires the same
unexpired display or admin session and uses private, no-store responses. It
reads only the selected roster documents and fields (name, role, seat,
checkedInAt), rechecking the current seat to exclude reassigned guests. The
minimal Firestore feed and browser security rules stay unchanged. Switching or
closing cards aborts pending lookups; failures offer a retry. Check-in changes
update an open card from the live feed without another guest-details request.

Firebase Auth is imported inside the optional-token fallback boundary so a
module-load failure cannot prevent password validation or polling access.
`package.json` overrides only the `jose` dependency used by `jwks-rsa` to
CommonJS-compatible 5.10.0. Firebase Admin 14 pulls `jwks-rsa` 4, whose
`require('jose')` fails with ESM-only jose 6 on runtimes where require(ESM)
is disabled. Track [Firebase issue #3181](https://github.com/firebase/firebase-admin-node/issues/3181)
before removing this compatibility override. A plain Node subprocess test with
`--no-experimental-require-module` verifies Auth loading, custom-token signing,
and JWKS public-key conversion with real dependencies and ephemeral test keys.

The footer is the time of the last successful snapshot, not a continuously
updated heartbeat. A quiet event need not receive new snapshots. Serverless
instances do not hold long-running stream connections; Firestore delivers them
directly to each authorized screen. Listener reads and the extra projection
writes incur Firestore usage.

## Local and production setup

`npm run dev` starts Firestore, Storage and Auth emulators with Next.js. Auth
uses port 9099. `npm run test:emulator` uses separate ports (Firestore 8181,
Storage 9299, Auth 9198) and never clears the development or live database.
Browser emulator connections are intended for a browser on the development
machine; emulators bind loopback.

Before deploying the branch to production:

1. Initialize Firebase Authentication in the existing Bloom Firebase project.
   Custom-token sign-in does not require enabling guest email/password login.
2. Deploy this branch's `firestore.rules` alongside the application. The rules
   permit only authenticated, unexpired display reads of `seatStatus` and
   `seatStatusMeta/checkIn`. Every browser write and every private collection
   read remains denied.
3. Keep `ADMIN_DASHBOARD_SECRET` and the existing Firebase service account
   configured server-side. Custom-token signing requires the service account's
   signing capability. Confirm that the existing Firebase web API key allows
   the Authentication API and deployed origin if it is restricted.
4. Leave all emulator host variables unset on the deployment. Open the display
   once to complete its initial backfill, then confirm **即時連線** and perform
   a check-in/undo rehearsal on the intended environment and venue network.

If Authentication or rules have not yet been deployed, authorized screens
fall back to polling and explicitly show **每 5 秒同步**. No Firebase rules or
live configuration are deployed by local development commands.

## Verification

Unit tests cover the field whitelist, normalized duplicate assignments,
unassigned arrivals, display cookie isolation, fixed expiry, API authorization,
polling recovery, and late-response cleanup. Emulator tests cover projection
consistency across roster mutations and resets, concurrent arrival/migration,
imports across a paired-write chunk boundary, and Firestore rules rejecting
private reads, browser writes, anonymous users and expired/unscoped sessions.

The venue geometry is explicit in `src/lib/seat-floor-plan.ts`. Guest names
remain excluded from the projection. VIP roster identifiers and rules for
opening reserve seats remain separate product decisions.
