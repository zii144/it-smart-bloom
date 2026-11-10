"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { formatTaipeiTime } from "@/lib/event-info";
import { buildSeatBoard, normalizeSeatLabel, type SeatStatusSnapshot } from "@/lib/seat-status";
import { useSeatStatus, type SeatConnection } from "@/lib/seat-status-client";
import { FLOOR_PLAN_COLUMNS, FLOOR_PLAN_LABELS, FLOOR_PLAN_ROWS, FLOOR_PLAN_SEATS, WIDE_PLAN_COLUMNS, WIDE_PLAN_ROW_Y } from "@/lib/seat-floor-plan";
import styles from "./seat-status-dashboard.module.css";
import { SeatGuestCard } from "./seat-guest-card";

const CONNECTION: Record<SeatConnection, string> = {
  connecting: "連線中", live: "即時連線", polling: "每 5 秒同步", offline: "連線中斷・保留最後資料", "auth-required": "等候顯示授權",
};

/** Seat geometry for one drawing; the seat markup itself is shared. */
type SeatGeometry = {
  columns: readonly number[]; rowY: readonly number[]; width: number; height: number; radius: number;
  labelDy: number; numberX: number; numberDy: number; tick: (x: number, y: number) => string; markDx: number; markDy: number;
};
const PORTRAIT_SEATS: SeatGeometry = {
  columns: FLOOR_PLAN_COLUMNS, rowY: FLOOR_PLAN_ROWS.map((row) => row.y), width: 21, height: 26, radius: 2,
  labelDy: 16, numberX: 397, numberDy: 17, tick: (x, y) => `M${x + 14} ${y + 4}l1.5 1.5 2.5-3`, markDx: 17.5, markDy: 6,
};
const WIDE_SEATS: SeatGeometry = {
  columns: WIDE_PLAN_COLUMNS, rowY: WIDE_PLAN_ROW_Y, width: 96, height: 36, radius: 4,
  labelDy: 25, numberX: 1556, numberDy: 25, tick: (x, y) => `M${x + 76} ${y + 10}l3.5 3.5 6-7`, markDx: 85, markDy: 14,
};
const WIDE_LAYOUT = "16x9";

function demoSnapshot(): SeatStatusSnapshot {
  return {
    entries: FLOOR_PLAN_SEATS.map((seat, index) => ({
      id: `demo-${seat.label}`, seat: seat.label,
      // Demo arrivals reproduce the reference's peach N/O rows.
      checkedInAt: index >= 156 ? "2026-11-10T05:10:00.000Z" : null,
    })),
    checkIn: { open: true, updatedAt: null }, verifiedAt: "2026-11-10T05:10:00.000Z",
  };
}

function VerticalLabel({ text, x, y, className }: { text: string; x: number; y: number; className?: string }) {
  return <text x={x} y={y} textAnchor="middle" className={className}>{[...text].map((letter, index) => <tspan key={index} x={x} dy={index ? "1.08em" : 0}>{letter}</tspan>)}</text>;
}

export function SeatStatusDashboard({ initialPreview = false, initialWide = false }: { initialPreview?: boolean; initialWide?: boolean }) {
  const [wide, setWide] = useState(initialWide);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [demo, setDemo] = useState(initialPreview);
  const [preview, setPreview] = useState<SeatStatusSnapshot | null>(() => initialPreview ? demoSnapshot() : null);
  const { snapshot: liveSnapshot, connection: liveConnection } = useSeatStatus(sessionVersion, demo);
  const snapshot = demo ? preview : liveSnapshot;
  const connection = demo ? "live" : liveConnection;
  const board = useMemo(() => buildSeatBoard(snapshot?.entries ?? []), [snapshot]);
  const mapped = useMemo(() => new Map(board.seats.map((seat) => [seat.label, seat])), [board]);
  const outsidePlan = board.seats.filter((seat) => !FLOOR_PLAN_LABELS.has(seat.label));
  const [key, setKey] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");
  const [informationOpen, setInformationOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedSeat, setSelectedSeat] = useState<{ seat: string; left: number; top: number } | null>(null);
  const hideGuestTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selectedEntries = useMemo(() => snapshot?.entries.filter((entry) => normalizeSeatLabel(entry.seat) === selectedSeat?.seat) ?? [], [snapshot, selectedSeat]);
  const previousArrivals = useRef(new Set<string>());
  const initialized = useRef(false);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const needsAuth = !demo && connection === "auth-required";
  const rate = board.total ? Math.round(board.arrived / board.total * 100) : 0;

  useEffect(() => {
    if (!snapshot) return;
    const arrivals = new Set(snapshot.entries.filter((entry) => entry.checkedInAt).map((entry) => entry.id));
    const newSeats = new Set(snapshot.entries.filter((entry) => arrivals.has(entry.id) && !previousArrivals.current.has(entry.id))
      .map((entry) => normalizeSeatLabel(entry.seat)));
    const first = !initialized.current;
    initialized.current = true;
    previousArrivals.current = arrivals;
    if (first || !newSeats.size) return;
    const timer = setTimeout(() => setHighlighted(newSeats), 0);
    return () => clearTimeout(timer);
  }, [snapshot]);

  useEffect(() => {
    if (!highlighted.size) return;
    const timer = setTimeout(() => setHighlighted(new Set()), 2_500);
    return () => clearTimeout(timer);
  }, [highlighted]);

  useEffect(() => {
    const changed = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  useEffect(() => () => clearTimeout(hideGuestTimer.current), []);

  function keepGuestOpen() { clearTimeout(hideGuestTimer.current); }
  function closeGuest() { keepGuestOpen(); setSelectedSeat(null); }
  function scheduleGuestClose() {
    keepGuestOpen();
    hideGuestTimer.current = setTimeout(() => setSelectedSeat(null), 180);
  }
  function showGuest(seat: string, target: SVGGElement) {
    keepGuestOpen();
    const rect = target.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    const left = rect.right + width + 12 <= window.innerWidth ? rect.right + 10 : rect.left - width - 10;
    setSelectedSeat({ seat, left: Math.max(12, Math.min(left, window.innerWidth - width - 12)), top: Math.max(12, Math.min(rect.top, window.innerHeight - 340)) });
  }

  async function signIn(event: FormEvent) {
    event.preventDefault(); setSigningIn(true); setError("");
    try {
      const response = await fetch("/api/seat-status/access", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(response.status === 404 ? "尚未設定工作人員密碼，請聯絡管理員。" : result?.error ?? "無法啟用看板，請重試。");
      }
      setKey(""); setSessionVersion((version) => version + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "無法啟用看板。"); }
    finally { setSigningIn(false); }
  }

  async function toggleFullscreen() {
    setError("");
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else setError("此瀏覽器不支援全螢幕，請使用瀏覽器的全螢幕功能。");
    } catch { setError("無法進入全螢幕，請使用瀏覽器的全螢幕功能。"); }
  }

  function openPreview() { setPreview(demoSnapshot()); setDemo(true); }

  function toggleWide() {
    const next = !wide;
    setWide(next); closeGuest();
    // Keep the choice in the address so a reload or bookmark reopens the same layout.
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("layout", WIDE_LAYOUT); else url.searchParams.delete("layout");
    window.history.replaceState(null, "", url);
  }

  function seatRows(plan: SeatGeometry) {
    return <g aria-label="A 至 O 排座位">
      {FLOOR_PLAN_ROWS.map((row, rowIndex) => { const y = plan.rowY[rowIndex]; return <g key={row.label} aria-label={`${row.label} 排`}>
        {plan.columns.map((x, column) => {
          const label = `${row.label}${column + 1}`;
          const seat = mapped.get(label);
          const conflict = Boolean(seat && seat.assigned > 1);
          const arrived = Boolean(seat?.arrived);
          const status = conflict ? `重複分配 ${seat!.assigned} 位，已報到 ${seat!.arrived} 位` : arrived ? "已報到" : seat ? "尚未報到" : snapshot ? "尚未分配" : "等候同步";
          // <title> must have one text child for SSR and hydration to agree.
          const tooltip = `${label}・${status}${arrived && seat?.checkedInAt ? `・${formatTaipeiTime(seat.checkedInAt)}` : ""}`;
          return <g key={label} className={`${styles.seat} ${rowIndex % 2 ? styles.alternate : ""} ${snapshot && !seat ? styles.unassigned : ""} ${arrived ? styles.arrived : ""} ${conflict ? styles.conflict : ""} ${highlighted.has(label) ? styles.justArrived : ""}`} aria-label={`${label}，${status}`}
            style={{ animationDelay: `${rowIndex * 26 + column * 8}ms` }}
            role="button" tabIndex={0} aria-haspopup="dialog" aria-expanded={!needsAuth && selectedSeat?.seat === label}
            aria-controls={!needsAuth && selectedSeat?.seat === label ? "seat-guest-card" : undefined} data-floor-seat
            onPointerEnter={(event) => showGuest(label, event.currentTarget)} onPointerLeave={scheduleGuestClose}
            onFocus={(event) => showGuest(label, event.currentTarget)} onBlur={(event) => {
              if (!(event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-guest-card]"))) scheduleGuestClose();
            }} onClick={(event) => showGuest(label, event.currentTarget)} onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showGuest(label, event.currentTarget); }
            }}>
            <title>{tooltip}</title>
            <rect x={x} y={y} width={plan.width} height={plan.height} rx={plan.radius} />
            <text x={x + plan.width / 2} y={y + plan.labelDy} textAnchor="middle" className={styles.seatLabel}>{label}</text>
            {arrived && !conflict && <path d={plan.tick(x, y)} pathLength={1} className={styles.arrivalTick} aria-hidden="true" />}
            {conflict && <text x={x + plan.markDx} y={y + plan.markDy} textAnchor="middle" className={styles.conflictMark}>!</text>}
          </g>;
        })}
        <text x={plan.numberX} y={y + plan.numberDy} textAnchor="middle" className={`${styles.rowNumber} ${rowIndex >= 13 ? styles.reservedNumber : ""}`}>{rowIndex + 3}</text>
      </g>; })}
    </g>;
  }

  const legendItems = <ul>
    <li><span className={`${styles.statusSwatch} ${styles.arrivedSwatch}`} aria-hidden="true">✓</span><span>已報到</span></li>
    <li><span className={`${styles.statusSwatch} ${styles.waitingSwatch}`} aria-hidden="true">○</span><span>未報到</span></li>
    <li><span className={`${styles.statusSwatch} ${styles.unassignedSwatch}`} aria-hidden="true">–</span><span>未分配</span></li>
  </ul>;
  const statusText = demo ? "示範資料・非即時報到" : CONNECTION[connection];
  const toolbarButtons = <div>
    <button type="button" onClick={() => setInformationOpen(!informationOpen)} aria-expanded={informationOpen} aria-controls="seat-display-information">看板資訊</button>
    <button type="button" onClick={toggleWide} aria-pressed={wide} aria-label={wide ? "切換為直式版面" : "切換為 16:9 版面"}>{wide ? "直式版面" : "16:9 版面"}</button>
    <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "離開全螢幕" : "進入全螢幕"}>{fullscreen ? "離開全螢幕" : "全螢幕"}</button>
  </div>;

  return (
    <main className={`${styles.dashboard} ${wide ? styles.wide : ""}`} onPointerDown={(event) => {
      if (!(event.target as Element).closest("[data-floor-seat], [data-guest-card]")) closeGuest();
    }} onKeyDown={(event) => { if (event.key === "Escape") closeGuest(); }}>
      {wide ? <section className={styles.wideMap} aria-label="座位報到狀態" inert={needsAuth}>
          <svg className={styles.widePlan} viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet" role="group" aria-labelledby="floor-plan-title floor-plan-description">
            <title id="floor-plan-title">114及115年度路老師頒獎授證典禮暨成果展座位圖</title>
            <desc id="floor-plan-description">16:9 橫式版面。舞台在上方，前方兩排 VIP，A 至 O 排每排十二席，每四席一組，保留兩條縱向走道與 C、J 排後方橫向走道。左側有茶水區、兩處門口及兩處報到區，後方 N、O 排為預備座。桃色代表已報到。</desc>
            <rect width="1600" height="900" rx="8" className={styles.paper} />
            <rect x="130" y="16" width="1382" height="52" rx="4" className={styles.stage} />
            <text x="821" y="53" textAnchor="middle" className={styles.stageText}>舞 台 區</text>
            {[82, 126].map((y, row) => <g key={y} aria-label={`VIP 第 ${row + 1} 排，場地標示`}>
              {[219, 914].flatMap((start) => [..."VIPVIP"].map((letter, index) => <g key={`${start}-${index}`}>
                <rect x={start + index * 87} y={y} width="74" height="36" rx="4" className={styles.vip} />
                <text x={start + index * 87 + 37} y={y + 25} textAnchor="middle" className={styles.vipText}>{letter}</text>
              </g>))}
              <text x="1556" y={y + 25} textAnchor="middle" className={`${styles.rowNumber} ${styles.redText}`}>{row + 1}</text>
            </g>)}
            {seatRows(WIDE_SEATS)}
            <path d="M80 16V631M80 671V770M80 810V892" className={styles.wall} />
            <path d="M80 631H60A20 20 0 0 0 80 651A20 20 0 0 0 60 671H80M80 770H60A20 20 0 0 0 80 790A20 20 0 0 0 60 810H80" className={styles.doors} />
            <rect x="88" y="382" width="24" height="168" rx="2" className={styles.stage} />
            <VerticalLabel text="茶水區" x={100} y={453} className={styles.teaText} />
            <rect x="22" y="684" width="34" height="72" rx="2" className={styles.vip} />
            <VerticalLabel text="報到區" x={39} y={707} className={styles.checkInText} />
            <rect x="22" y="822" width="34" height="64" rx="2" className={styles.vip} />
            <VerticalLabel text="報到區" x={39} y={841} className={styles.checkInText} />
            <VerticalLabel text="預備座" x={1556} y={818} className={styles.reservedText} />
          </svg>
        </section>
      : <>
      <section className={styles.mapFrame} aria-label="座位報到狀態" inert={needsAuth}>
        <svg className={styles.floorPlan} viewBox="0 0 418 745" preserveAspectRatio="xMidYMid meet" role="group" aria-labelledby="floor-plan-title floor-plan-description">
          <title id="floor-plan-title">114及115年度路老師頒獎授證典禮暨成果展座位圖</title>
          <desc id="floor-plan-description">舞台前方兩排 VIP，A 至 O 排每排十二席，每四席一組，保留兩條縱向走道與 C、J 排後方橫向走道。左側有茶水區、兩處門口及兩處報到區，後方 N、O 排為預備座。桃色代表已報到。</desc>
          <rect width="418" height="745" className={styles.paper} />
          <text x="26" y="26" className={styles.mapTitle} textLength="321" lengthAdjust="spacingAndGlyphs">114及115年度路老師頒獎授證典禮暨成果展</text>
          <text x="347" y="26" className={`${styles.mapTitle} ${styles.redText}`} textLength="45" lengthAdjust="spacingAndGlyphs">座位圖</text>
          <path d="M22 35.5H398" className={styles.titleRule} />
          <rect x="57" y="45" width="326" height="35" rx="2" className={styles.stage} />
          <text x="220" y="68" textAnchor="middle" className={styles.stageText}>舞 台 區</text>
          {[91, 126].map((y, row) => <g key={y} aria-label={`VIP 第 ${row + 1} 排，場地標示`}>
            {[78, 242].flatMap((start) => [..."VIPVIP"].map((letter, index) => <g key={`${start}-${index}`}>
              <rect x={start + index * 20.5} y={y} width="17" height="26" rx="2" className={styles.vip} />
              <text x={start + index * 20.5 + 8.5} y={y + 17} textAnchor="middle" className={styles.vipText}>{letter}</text>
            </g>))}
            <text x="397" y={y + 17} textAnchor="middle" className={`${styles.rowNumber} ${styles.redText}`}>{row + 1}</text>
          </g>)}
          {seatRows(PORTRAIT_SEATS)}
          <path d="M31.5 45V522M31.5 554V630.5M31.5 662.5V741" className={styles.wall} />
          <path d="M31.5 522H15.5A16 16 0 0 0 31.5 538A16 16 0 0 0 15.5 554H31.5M31.5 630.5H15.5A16 16 0 0 0 31.5 646.5A16 16 0 0 0 15.5 662.5H31.5" className={styles.doors} />
          <rect x="37" y="330" width="15" height="131" rx="1" className={styles.stage} />
          <VerticalLabel text="茶水區" x={44.5} y={385} className={styles.teaText} />
          <rect x="9" y="568" width="17" height="41" rx="1" className={styles.vip} />
          <VerticalLabel text="報到區" x={17.5} y={579} className={styles.checkInText} />
          <rect x="9" y="684" width="17" height="46" rx="1" className={styles.vip} />
          <VerticalLabel text="報到區" x={17.5} y={698} className={styles.checkInText} />
          <VerticalLabel text="預備座" x={397} y={683} className={styles.reservedText} />
        </svg>
      </section>
      <section className={styles.statusLegend} aria-label="報到狀態圖例" inert={needsAuth}>
        <h2>顏色說明</h2>
        {legendItems}
        <p>白色／淺綠色皆為未報到；磚紅色為 VIP 區標示。</p>
      </section>
      </>}
      <footer className={styles.toolbar} inert={needsAuth}>
        <span role="status" className={connection === "offline" ? styles.offline : undefined}>{statusText}</span>
        {toolbarButtons}
      </footer>
      {!needsAuth && selectedSeat && <SeatGuestCard key={`${demo}:${sessionVersion}:${selectedSeat.seat}:${selectedEntries.map((entry) => entry.id).join(",")}`}
        seat={selectedSeat.seat} entries={selectedEntries} demo={demo} position={{ left: selectedSeat.left, top: selectedSeat.top }}
        onClose={closeGuest} onEnter={keepGuestOpen} onLeave={scheduleGuestClose} />}
      {informationOpen && <aside className={styles.information} id="seat-display-information" aria-label="看板資訊" inert={needsAuth}>
        <div className={styles.informationHeading}><h2>報到資訊</h2><button onClick={() => setInformationOpen(false)} aria-label="關閉看板資訊">×</button></div>
        <section aria-label="報到統計" className={styles.metrics}><p>已報到<strong>{snapshot ? board.arrived : "—"} 位</strong></p><p>尚未報到<strong>{snapshot ? board.waiting : "—"} 位</strong></p><p>名單總人數<strong>{snapshot ? board.total : "—"} 位</strong></p></section>
        <div className={styles.progress} role="progressbar" aria-label="報到進度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rate}><span style={{ width: `${rate}%` }} /></div>
        <p>報到進度 {rate}%・{snapshot?.checkIn.open ? "現正開放報到" : "報到尚未開放／已關閉"}</p>
        <p>桃色（#F8DDD3）代表已報到。N、O 排為預備座；VIP 區依參考圖保留場地標示，尚未對應名單編號。</p>
        {board.conflicts > 0 && <p className={styles.warning}>重複座位 {board.conflicts}，請工作人員確認。</p>}
        {board.unassigned > 0 && <p>{board.unassigned} 位尚未分配座位（已計入總人數）</p>}
        {outsidePlan.length > 0 && <p className={styles.warning}>場地圖外的座位：{outsidePlan.map((seat) => seat.label).join("、")}。已保留在統計中，請確認座位編號。</p>}
        <p>{snapshot ? `最後同步 ${formatTaipeiTime(snapshot.verifiedAt)}` : "等候連線"}・報到不代表已入座</p>
        {demo ? <button className={styles.primaryButton} onClick={() => setDemo(false)}>返回即時看板</button> : <button onClick={openPreview}>先預覽看板版面</button>}
      </aside>}
      {error && !needsAuth && <div className={styles.notice} role="alert">{error}<button onClick={() => setError("")} aria-label="關閉提示">×</button></div>}
      {needsAuth && <div className={styles.loginOverlay}><section className={styles.loginCard} role="dialog" aria-modal="true" aria-labelledby="display-login-title"><span>智晟｜綻放</span><h2 id="display-login-title">啟用座位看板</h2><p>輸入工作人員密碼，開始同步現場報到。</p><form onSubmit={signIn}><label htmlFor="seat-display-key">工作人員密碼</label><input id="seat-display-key" type="password" autoComplete="current-password" value={key} onChange={(event) => setKey(event.target.value)} required autoFocus /><button className={styles.primaryButton} type="submit" disabled={signingIn}>{signingIn ? "正在準備看板…" : "啟用即時看板"}</button>{error && <p className={styles.warning} role="alert">{error}</p>}</form><button className={styles.previewButton} onClick={openPreview}>先預覽看板版面</button><small>顯示授權有效 12 小時</small></section></div>}
    </main>
  );
}
