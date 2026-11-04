"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { EVENT_INFO, formatTaipeiTime } from "@/lib/event-info";
import { buildSeatBoard, type SeatStatusSnapshot } from "@/lib/seat-status";
import { useSeatStatus, type SeatConnection } from "@/lib/seat-status-client";
import styles from "./seat-status-dashboard.module.css";

const CONNECTION: Record<SeatConnection, string> = {
  connecting: "連線中", live: "即時連線", polling: "每 5 秒同步", offline: "連線中斷・保留最後資料", "auth-required": "等候顯示授權",
};

function StatusMark({ checked, conflict = false }: { checked: boolean; conflict?: boolean }) {
  return <span className={styles.mark} aria-hidden="true">{conflict ? "!" : checked ? "✓" : "○"}</span>;
}

/** Preview data is generated in the browser, visibly labelled and never written. */
function demoSnapshot(): SeatStatusSnapshot {
  return {
    entries: Array.from({ length: 144 }, (_, index) => ({
      id: `demo-${index}`,
      seat: `${String.fromCharCode(65 + Math.floor(index / 18))}${index % 18 + 1}`,
      checkedInAt: index % 5 < 3 ? new Date(Date.now() - (144 - index) * 20_000).toISOString() : null,
    })),
    checkIn: { open: true, updatedAt: null }, verifiedAt: new Date().toISOString(),
  };
}

export function SeatStatusDashboard() {
  const [sessionVersion, setSessionVersion] = useState(0);
  const [demo, setDemo] = useState(false);
  const [preview, setPreview] = useState<SeatStatusSnapshot | null>(null);
  const { snapshot: liveSnapshot, connection: liveConnection } = useSeatStatus(sessionVersion, demo);
  const snapshot = demo ? preview : liveSnapshot;
  const connection = demo ? "live" : liveConnection;
  const board = useMemo(() => buildSeatBoard(snapshot?.entries ?? []), [snapshot]);
  const [key, setKey] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState("");
  const [page, setPage] = useState(0);
  const [rotating, setRotating] = useState(true);
  const [capacity, setCapacity] = useState(120);
  const [columns, setColumns] = useState(12);
  const [fullscreen, setFullscreen] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const recentIds = useRef(new Set<string>());
  const arrivalsInitialized = useRef(false);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const activeSection = board.sections.includes(section) ? section : "";
  const seats = activeSection ? board.seats.filter((seat) => seat.section === activeSection) : board.seats;
  const pages = Math.max(1, Math.ceil(seats.length / capacity));
  const currentPage = Math.min(page, pages - 1);
  const visibleSeats = seats.slice(currentPage * capacity, (currentPage + 1) * capacity);
  const rate = board.total ? Math.round(board.arrived / board.total * 100) : 0;
  const needsAuth = !demo && connection === "auth-required";

  useEffect(() => {
    const container = grid.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const cols = Math.max(1, Math.floor(entry.contentRect.width / 72));
      const rows = Math.max(1, Math.floor(entry.contentRect.height / 68));
      setColumns(cols);
      setCapacity(cols * rows);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!rotating || pages <= 1 || needsAuth) return;
    const timer = setInterval(() => setPage((page) => (page + 1) % pages), 12_000);
    return () => clearInterval(timer);
  }, [rotating, pages, needsAuth]);

  useEffect(() => {
    if (!snapshot) return;
    const arrived = new Set(snapshot.entries.filter((entry) => entry.checkedInAt).map((entry) => entry.id));
    const newSeats = new Set(snapshot.entries.filter((entry) => arrived.has(entry.id) && !recentIds.current.has(entry.id))
      .map((entry) => entry.seat.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase()));
    const initial = !arrivalsInitialized.current;
    arrivalsInitialized.current = true;
    recentIds.current = arrived;
    if (initial || !newSeats.size) return;
    const start = setTimeout(() => setHighlighted(newSeats), 0);
    return () => clearTimeout(start);
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

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setSigningIn(true);
    setError("");
    try {
      const response = await fetch("/api/seat-status/access", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(response.status === 404 ? "尚未設定工作人員密碼，請聯絡管理員。" : result?.error ?? "無法啟用看板，請重試。");
      }
      setKey("");
      setSessionVersion((version) => version + 1);
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

  function openPreview() { setPreview(demoSnapshot()); setDemo(true); setPage(0); }

  return (
    <main className={styles.dashboard}>
      <header className={styles.header} inert={needsAuth}>
        <div className={styles.brand}><span className={styles.brandFlower} aria-hidden="true">✳</span><span>智晟<span className={styles.brandDivider}>／</span>綻放<small>每一份抵達，都是相聚的開始</small></span></div>
        <div className={styles.heading}><p>LIVE ATTENDANCE</p><h1>即時座位看板</h1></div>
        <div className={styles.headerActions}>
          <span className={`${styles.connection} ${connection === "live" ? styles.connected : ""}`} role="status"><i />{demo ? "示範資料・非即時報到" : CONNECTION[connection]}</span>
          <button type="button" className={styles.iconButton} onClick={toggleFullscreen} aria-label={fullscreen ? "離開全螢幕" : "進入全螢幕"}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /></svg>
          </button>
        </div>
      </header>

      {demo && <div className={styles.demoBanner}>版面預覽・所有座位與報到均為示範資料<button onClick={() => { setDemo(false); setPage(0); }}>返回即時看板</button></div>}

      <section className={styles.metrics} aria-label="報到統計" inert={needsAuth}>
        <div className={styles.primaryMetric}><span>已報到</span><strong>{snapshot ? board.arrived : "—"}<small>位</small></strong><span className={styles.metricNote}>歡迎來到綻放</span></div>
        <div><span>尚未報到</span><strong>{snapshot ? board.waiting : "—"}<small>位</small></strong></div>
        <div><span>名單總人數</span><strong>{snapshot ? board.total : "—"}<small>位</small></strong></div>
        <div className={styles.progressMetric}><div><span>報到進度</span><strong>{snapshot ? rate : "—"}<small>%</small></strong></div><div className={styles.progressTrack} role="progressbar" aria-label="報到進度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={rate}><span style={{ width: `${rate}%` }} /></div><small>{snapshot ? (snapshot.checkIn.open ? "現正開放報到" : "報到尚未開放／已關閉") : "等候資料同步"}</small></div>
      </section>

      <div className={styles.workspace} inert={needsAuth}>
        <section className={styles.board} aria-label="座位報到狀態">
          <div className={styles.boardHeader}><div><h2>座位一覽<span>{snapshot ? `${board.seats.length} 個座位` : ""}</span></h2><p>依座位編號排列・顯示報到狀態</p></div>
            <label className={styles.sectionSelect}><span className={styles.srOnly}>篩選座位區域</span><select value={activeSection} onChange={(event) => { setSection(event.target.value); setPage(0); }}><option value="">全部區域</option>{board.sections.map((value) => <option key={value} value={value}>{value === "其他" ? value : `${value} 區`}</option>)}</select></label>
          </div>
          <div className={styles.legend}><span><StatusMark checked />已報到</span><span><StatusMark checked={false} />尚未報到</span>{board.conflicts > 0 && <span className={styles.conflictLegend}><StatusMark checked={false} conflict />重複座位 {board.conflicts}</span>}</div>
          <div ref={grid} className={styles.gridViewport}>
            {!snapshot ? <div className={styles.empty}><span className={styles.emptyFlower} aria-hidden="true">✳</span><h3>{needsAuth ? "準備迎接每一份抵達" : "正在連線座位看板"}</h3><p>{needsAuth ? "工作人員啟用後，報到狀態將自動同步。" : connection === "offline" ? "暫時無法連線，正在自動重試。" : "正在取得最新報到資料，請稍候。"}</p>{!needsAuth && <button onClick={openPreview} className={styles.textButton}>先預覽看板版面</button>}</div>
              : visibleSeats.length === 0 ? <div className={styles.empty}><h3>{board.total ? "尚未分配座位" : "名單尚未匯入"}</h3><p>{board.total ? "報到人數仍會同步；分配座位後會自動顯示。" : "請在管理後台匯入活動名單與座位編號。"}</p></div>
                : <div className={styles.seatGrid} style={{ "--seat-columns": columns } as CSSProperties}>{visibleSeats.map((seat) => {
                  const conflict = seat.assigned > 1;
                  const checked = seat.arrived > 0;
                  return <div key={seat.label} className={`${styles.seat} ${conflict ? styles.conflict : checked ? styles.arrived : styles.waiting} ${highlighted.has(seat.label) ? styles.justArrived : ""}`} aria-label={`${seat.label}，${conflict ? `重複分配 ${seat.assigned} 位，已報到 ${seat.arrived} 位` : checked ? "已報到" : "尚未報到"}`} title={conflict ? `${seat.assigned} 位共用此座位，請工作人員確認` : checked ? `報到時間 ${formatTaipeiTime(seat.checkedInAt!)}` : "尚未報到"}><StatusMark checked={checked} conflict={conflict} /><strong>{seat.label}</strong>{conflict && <small>{seat.arrived}/{seat.assigned}</small>}</div>;
                })}</div>}
          </div>
          <div className={styles.boardFooter}><span>{board.unassigned > 0 ? `${board.unassigned} 位尚未分配座位（已計入總人數）` : "報到不代表已入座"}</span><div className={styles.pagination}>{pages > 1 && <><button aria-label="上一頁座位" onClick={() => setPage((currentPage + pages - 1) % pages)}>‹</button><span>{currentPage + 1} / {pages}</span><button aria-label="下一頁座位" onClick={() => setPage((currentPage + 1) % pages)}>›</button><button onClick={() => setRotating(!rotating)} aria-pressed={rotating}>{rotating ? "暫停輪播" : "自動輪播"}</button></>}</div></div>
        </section>

        <aside className={styles.sidebar}>
          <div className={styles.recent}><div className={styles.asideTitle}><h2>最新抵達</h2><span>WELCOME</span></div><p>每一個亮起的座位，都是期待的相聚。</p><ol>{board.recent.map((seat, index) => <li key={seat.label}><span className={styles.recentNumber}>{String(index + 1).padStart(2, "0")}</span><strong>{seat.label}<small>已報到{seat.assigned > 1 ? ` ${seat.arrived}/${seat.assigned}` : ""}</small></strong><time dateTime={seat.checkedInAt!}>{formatTaipeiTime(seat.checkedInAt!)}</time></li>)}</ol>{board.recent.length === 0 && <div className={styles.recentEmpty}>等候第一份抵達</div>}</div>
          <div className={styles.event}><span>相聚・綻放</span><strong>路老師培訓宣講計畫<br />成果展</strong><p>{EVENT_INFO.date}<br />{EVENT_INFO.venue}</p></div>
        </aside>
      </div>
      <footer className={styles.footer}><span>智晟｜綻放 <span className={styles.footerDot}>·</span> 即時報到看板</span><span>{snapshot ? `最後同步 ${formatTaipeiTime(snapshot.verifiedAt)}` : "等候連線"}</span></footer>
      {error && !needsAuth && <div className={styles.notice} role="alert">{error}<button onClick={() => setError("")} aria-label="關閉提示">×</button></div>}

      {needsAuth && <div className={styles.loginOverlay}><section className={styles.loginCard} role="dialog" aria-modal="true" aria-labelledby="display-login-title"><span className={styles.loginEyebrow}>智晟｜綻放</span><h2 id="display-login-title">啟用座位看板</h2><p>輸入工作人員密碼，開始同步現場報到。<br />本畫面僅顯示座位與報到狀態。</p><form onSubmit={signIn}><label htmlFor="seat-display-key">工作人員密碼</label><input id="seat-display-key" type="password" autoComplete="current-password" value={key} onChange={(event) => setKey(event.target.value)} required autoFocus /><button type="submit" disabled={signingIn}>{signingIn ? "正在準備看板…" : "啟用即時看板"}</button>{error && <p className={styles.loginError} role="alert">{error}</p>}</form><button className={styles.textButton} onClick={openPreview}>先預覽看板版面</button><small>顯示授權有效 12 小時</small></section></div>}
    </main>
  );
}
