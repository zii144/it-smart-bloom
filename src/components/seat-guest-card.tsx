"use client";

import { useEffect, useState } from "react";
import { formatTaipeiTime } from "@/lib/event-info";
import { FLOOR_PLAN_SEATS } from "@/lib/seat-floor-plan";
import { MAX_SEAT_GUEST_LOOKUP, type SeatGuest, type SeatStatusEntry } from "@/lib/seat-status";
import styles from "./seat-status-dashboard.module.css";

const DEMO_NAMES = ["陳怡安", "林志明", "王美玲", "李淑芬", "張國華", "黃雅惠", "吳建宏", "劉秀琴"];

export function SeatGuestCard({ seat, entries, demo, position, onClose, onEnter, onLeave }: {
  seat: string;
  entries: SeatStatusEntry[];
  demo: boolean;
  position: { left: number; top: number };
  onClose: () => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const [guests, setGuests] = useState<SeatGuest[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const idsKey = entries.slice(0, MAX_SEAT_GUEST_LOOKUP).map((entry) => entry.id).join(",");

  useEffect(() => {
    if (demo || !idsKey) return;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(async () => {
      timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const query = new URLSearchParams({ seat, ids: idsKey });
        const response = await fetch(`/api/seat-status/guests?${query}`, {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error(response.status === 401 ? "顯示授權已到期，請重新登入。" : "暫時無法讀取來賓資料。");
        const payload = await response.json() as { guests: SeatGuest[] };
        if (!controller.signal.aborted) setGuests(payload.guests);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "暫時無法讀取來賓資料。");
        else if (timeout !== undefined) setError("讀取逾時，請重試。");
      } finally { clearTimeout(timeout); }
    }, 150);
    return () => { clearTimeout(timer); clearTimeout(timeout); timeout = undefined; controller.abort(); };
  }, [seat, idsKey, demo, retry]);

  const demoIndex = FLOOR_PLAN_SEATS.findIndex((item) => item.label === seat);
  const shownGuests = demo ? entries.map((entry, index) => ({
    ...entry, name: DEMO_NAMES[(Math.max(0, demoIndex) + index) % DEMO_NAMES.length], role: "路老師（示範）",
  })) : guests;
  const liveEntries = new Map(entries.map((entry) => [entry.id, entry]));

  return <aside id="seat-guest-card" className={styles.guestCard} role="dialog" aria-label={`${seat} 來賓資訊`}
    style={position} onPointerEnter={onEnter} onPointerLeave={onLeave} onFocus={onEnter}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onLeave(); }}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }} data-guest-card>
    <header><div><span>座位</span><h2>{seat}</h2></div><button type="button" aria-label="關閉來賓資訊" onClick={onClose}>×</button></header>
    {demo && <p className={styles.guestDemo}>示範資料</p>}
    {entries.length > 1 && <p className={styles.warning}>此座位重複分配 {entries.length} 位來賓</p>}
    {!entries.length ? <p className={styles.guestEmpty}>此座位尚未分配來賓。</p>
      : error ? <div role="alert"><p>{error}</p><button onClick={() => { setError(""); setRetry((value) => value + 1); }}>重試</button></div>
        : shownGuests === null ? <p className={styles.guestEmpty} role="status">正在讀取來賓資料…</p>
          : !shownGuests.length ? <p className={styles.guestEmpty}>座位名單已更新，請重新移至座位查看。</p>
            : <ul>{shownGuests.map((guest) => {
              const current = liveEntries.get(guest.id);
              const checkedInAt = current ? current.checkedInAt : guest.checkedInAt;
              return <li key={guest.id}><strong className={styles.guestName}>{guest.name}</strong>
                {guest.role && <span className={styles.guestRole}>{guest.role}</span>}
                <div className={`${styles.guestStatus} ${checkedInAt ? styles.guestArrived : ""}`}><span>{checkedInAt ? "✓ 已報到" : "○ 尚未報到"}</span>
                  {checkedInAt && <time dateTime={checkedInAt}>{formatTaipeiTime(checkedInAt)}</time>}</div>
              </li>;
            })}</ul>}
    {entries.length > MAX_SEAT_GUEST_LOOKUP && <p>名單較多，請至後台查看完整名單。</p>}
  </aside>;
}
