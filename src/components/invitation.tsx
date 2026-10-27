import type { ReactNode } from "react";
import { BloomMark } from "@/components/brand";
import { EVENT_INFO } from "@/lib/event-info";

/**
 * Building blocks of the 成果展 invitation card, shared by the booth's
 * welcome card, the success card and the check-in card so they read as one
 * printed set.
 */

export function InvitationRule() {
  return (
    <div className="invitation-rule" aria-hidden="true">
      <span />
      <svg viewBox="0 0 48 24">
        <path d="M24 5l4 7-4 7-4-7z" />
        <path d="M19 12c-5 0-8-5-13-3-3 1-2 6 3 5 3-.5 4-3 2-4" />
        <path d="M29 12c5 0 8-5 13-3 3 1 2 6-3 5-3-.5-4-3-2-4" />
        <circle cx="24" cy="1.5" r="1" />
        <circle cx="24" cy="22.5" r="1" />
      </svg>
      <span />
    </div>
  );
}

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="icon-ghost-line" d="M5 12.4h14M14.2 7.2l5 5-5 5" />
      <path d="M5 12h14M14 7l5 5-5 5" />
    </svg>
  );
}

export function LineIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.7 9.7c0-4-4-7.3-8.9-7.3S1.9 5.7 1.9 9.7c0 3.6 3.2 6.7 7.5 7.2.29.06.69.19.79.44.09.23.06.59.03.82l-.14.86c-.04.25-.2 1 .95.54 1.15-.44 6.2-3.65 8.47-6.25 1.56-1.7 2.2-3.42 2.2-5.11Z"
      />
    </svg>
  );
}

/** The card itself: floral paper, inner frame and the two ink corners. */
export function InvitationCard({
  className,
  labelledBy,
  children,
}: {
  className?: string;
  labelledBy?: string;
  children: ReactNode;
}) {
  return (
    <article
      className={`invitation-card${className ? ` ${className}` : ""}`}
      aria-labelledby={labelledBy}
    >
      <div className="invitation-paper" aria-hidden="true" />
      <span className="invitation-corner invitation-corner-one" aria-hidden="true" />
      <span className="invitation-corner invitation-corner-two" aria-hidden="true" />
      {children}
    </article>
  );
}

export function InvitationOverline() {
  return (
    <>
      <p className="invitation-overline">
        <span>{EVENT_INFO.organizer}</span>
      </p>
      <p className="invitation-program">
        {EVENT_INFO.program[0]}
        <br />
        {EVENT_INFO.program[1]}
      </p>
    </>
  );
}

export function InvitationDetails({
  children,
  showTime = true,
}: {
  /** Extra rows placed before the event rows, e.g. 座位. */
  children?: ReactNode;
  showTime?: boolean;
}) {
  return (
    <dl className="invitation-details">
      {children}
      <div>
        <dt>日期</dt>
        <dd>{EVENT_INFO.date}</dd>
      </div>
      {showTime && (
        <div>
          <dt>時間</dt>
          <dd>
            {EVENT_INFO.time}
            <small>{EVENT_INFO.checkInOpens}</small>
          </dd>
        </div>
      )}
      <div>
        <dt>場地</dt>
        <dd>
          {EVENT_INFO.venue}
          <small>{EVENT_INFO.address}</small>
        </dd>
      </div>
    </dl>
  );
}

export function InvitationSignature({ children }: { children: ReactNode }) {
  return (
    <p className="invitation-signature">
      <span>{children}</span>
    </p>
  );
}

/**
 * A round coral seal stamped onto the card with a five-petal blossom — the
 * same flower as the brand mark — rather than any character. It lands with
 * a small bounce; reduced motion just shows it.
 */
export function CelebrationSeal() {
  return (
    <p className="celebration-seal" aria-hidden="true">
      <svg viewBox="0 0 40 40">
        {[0, 72, 144, 216, 288].map((angle) => (
          <ellipse
            key={angle}
            cx="20"
            cy="11.2"
            rx="6.2"
            ry="8.4"
            transform={`rotate(${angle} 20 20)`}
          />
        ))}
        <circle className="celebration-seal-heart" cx="20" cy="20" r="4.4" />
      </svg>
    </p>
  );
}

/** Page chrome shared by the guest-facing routes outside the booth. */
export function GuestShell({
  note,
  children,
}: {
  /** Small label at the header's right, e.g. 成果展報到; omit for none. */
  note?: string;
  children: ReactNode;
}) {
  return (
    <main className="booth-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="site-header">
        <BloomMark />
        {note && (
          <div className="privacy-note">
            <span className="privacy-dot" />
            {note}
          </div>
        )}
      </header>

      <section className="booth-stage booth-stage-invitation">
        <div className="invitation-welcome">{children}</div>
      </section>

      <footer className="site-footer">
        <span>個人資料僅用於本次成果展報到與似顏繪。</span>
      </footer>
    </main>
  );
}
