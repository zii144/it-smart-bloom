"use client";

import Image from "next/image";
import { RoadTeacherAvatarAction } from "@/components/road-teacher-avatar-action";
import Link from "next/link";
import { useRef, useState } from "react";
import {
  ArrowIcon,
  CelebrationSeal,
  InvitationCard,
  InvitationDetails,
  InvitationOverline,
  InvitationRule,
  InvitationSignature,
} from "@/components/invitation";
import { formatTaipeiTime } from "@/lib/event-info";
import {
  isValidGuestName,
  isValidMobile,
  normalizeGuestName,
  normalizeMobile,
} from "@/lib/guest-identity";

type PortraitStatus = "ready" | "generating" | "complete" | "failed";

type CheckInDone = {
  name: string;
  seat: string;
  checkedInAt: string;
  alreadyCheckedIn: boolean;
  /** The portrait is handed over here, never on the success card. */
  portrait: { status: PortraitStatus | null; url: string | null };
};

type GuestDetails = { name: string; phone: string };

export type CheckInAvailability = "open" | "closed" | "unavailable";

function ClosedCard({ unavailable }: { unavailable: boolean }) {
  return (
    <InvitationCard className="celebration-card" labelledBy="check-in-title">
      <InvitationOverline />
      <InvitationRule />
      <h1 id="check-in-title" className="celebration-title">
        <span className="celebration-greeting">
          {unavailable ? "報到服務暫停中" : "報到尚未開放"}
        </span>
      </h1>
      <p className="invitation-title-sub">
        {unavailable ? "請洽現場工作人員" : "活動當天現場開放報到"}
      </p>
      <InvitationRule />
      <InvitationDetails />
      <InvitationSignature>敬邀蒞臨</InvitationSignature>
      <p className="invitation-footnote">為您留一席溫柔的光</p>
    </InvitationCard>
  );
}

function PortraitHandover({
  portrait,
  onRefresh,
  refreshing,
}: {
  portrait: CheckInDone["portrait"];
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (portrait.status === "complete" && portrait.url) {
    return (
      <figure className="check-in-portrait">
        <Image
          src={portrait.url}
          alt="您的路老師似顏繪"
          width={640}
          height={640}
          unoptimized
        />
        <figcaption>您的路老師似顏繪</figcaption>
      </figure>
    );
  }

  if (portrait.status === "ready" || portrait.status === "generating") {
    return (
      <div className="check-in-portrait-note">
        <p>您的似顏繪仍在創作中，請稍候片刻。</p>
        <button
          type="button"
          className="secondary-button"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? "查看中…" : "再看一次"}
        </button>
      </div>
    );
  }

  return (
    <div className="check-in-portrait-note">
      <p>
        {portrait.status === "failed"
          ? "這次似顏繪未能完成，請洽現場工作人員協助。"
          : "您還沒有建立似顏繪，歡迎現場體驗。"}
      </p>
    </div>
  );
}

function DoneCard({
  done,
  onRefresh,
  refreshing,
}: {
  done: CheckInDone;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const time = formatTaipeiTime(done.checkedInAt);
  const portraitUrl =
    done.portrait.status === "complete" ? done.portrait.url : null;

  return (
    <InvitationCard className="celebration-card" labelledBy="check-in-title">
      <InvitationOverline />
      <InvitationRule />
      <CelebrationSeal />
      <h1 id="check-in-title" className="celebration-title">
        <span className="celebration-name">{done.name}</span>
        <span className="celebration-greeting">
          {done.alreadyCheckedIn ? "您已完成報到" : "報到成功，歡迎蒞臨"}
        </span>
      </h1>
      <p className="invitation-title-sub" role="status">
        {done.alreadyCheckedIn ? `報到時間 ${time}` : `抵達時間 ${time}`}
      </p>
      <InvitationRule />
      {done.seat ? (
        <div className="celebration-ticket">
          <span>您的座位</span>
          <strong>{done.seat}</strong>
        </div>
      ) : null}
      <PortraitHandover
        portrait={done.portrait}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />
      <InvitationSignature>敬祝 活動愉快</InvitationSignature>
      {portraitUrl ? (
        <a
          className="primary-button invitation-button"
          href={`${portraitUrl}?download=1`}
          download
        >
          儲存作品
          <span className="button-arrow">
            <ArrowIcon />
          </span>
        </a>
      ) : !done.portrait.status ? (
        <Link className="primary-button invitation-button" href="/">
          體驗路老師似顏繪
          <span className="button-arrow">
            <ArrowIcon />
          </span>
        </Link>
      ) : null}
      {portraitUrl && (
        <RoadTeacherAvatarAction
          checkInToken={portraitUrl.split("/").at(-1)!}
        />
      )}
      <p className="invitation-footnote">把一路走來的光，畫成你的模樣</p>
    </InvitationCard>
  );
}

export function CheckInCard({
  availability,
}: {
  availability: CheckInAvailability;
}) {
  const [state, setState] = useState<CheckInAvailability>(availability);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<"name" | "phone" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<CheckInDone | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  /** Kept so 再看一次 can ask again without the guest retyping anything. */
  const lastDetails = useRef<GuestDetails | null>(null);

  if (done) {
    return (
      <DoneCard
        done={done}
        refreshing={submitting}
        onRefresh={() => {
          if (lastDetails.current) void send(lastDetails.current);
        }}
      />
    );
  }
  if (state !== "open")
    return <ClosedCard unavailable={state === "unavailable"} />;

  async function submit() {
    if (submitting) return;
    const cleanName = normalizeGuestName(name);
    const cleanPhone = normalizeMobile(phone);
    if (!isValidGuestName(cleanName)) {
      setError("請填寫報名時的姓名。");
      setInvalid("name");
      nameRef.current?.focus();
      return;
    }
    if (!isValidMobile(cleanPhone)) {
      setError("手機需為 09 開頭的 10 碼號碼，例如 0912345678。");
      setInvalid("phone");
      phoneRef.current?.focus();
      return;
    }

    setError(null);
    setInvalid(null);
    await send({ name: cleanName, phone: cleanPhone });
  }

  async function send(details: GuestDetails) {
    lastDetails.current = details;
    setSubmitting(true);
    try {
      const response = await fetch("/api/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(details),
      });
      const payload = (await response.json().catch(() => null)) as
        | (CheckInDone & { error?: undefined })
        | { error?: string; closed?: boolean }
        | null;
      if (response.ok && payload && "checkedInAt" in payload) {
        setDone(payload);
        return;
      }
      if (payload && "closed" in payload && payload.closed) {
        setState("closed");
        return;
      }
      setError(payload?.error || "暫時無法完成報到，請洽現場工作人員。");
      nameRef.current?.focus();
    } catch {
      setError("網路連線不穩，請再試一次。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <InvitationCard className="celebration-card" labelledBy="check-in-title">
      <InvitationOverline />
      <InvitationRule />
      <h1 id="check-in-title" className="celebration-title">
        <span className="celebration-greeting">來賓報到</span>
      </h1>
      <p className="invitation-title-sub">歡迎蒞臨成果展</p>
      <InvitationRule />

      <form
        className="check-in-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor="check-in-name">
          <span>姓名</span>
          <input
            ref={nameRef}
            id="check-in-name"
            name="name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
              setInvalid(null);
            }}
            autoComplete="name"
            placeholder="報名時的姓名"
            maxLength={60}
            aria-invalid={invalid === "name" || undefined}
            required
          />
        </label>
        <label htmlFor="check-in-phone">
          <span>手機</span>
          <input
            ref={phoneRef}
            id="check-in-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setError(null);
              setInvalid(null);
            }}
            autoComplete="tel"
            placeholder="0912345678"
            aria-invalid={invalid === "phone" || undefined}
            required
          />
        </label>
        {error && (
          <p className="check-in-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="primary-button invitation-button"
          disabled={submitting}
          aria-busy={submitting || undefined}
        >
          {submitting ? "報到中…" : "我已抵達"}
          <span className="button-arrow">
            <ArrowIcon />
          </span>
        </button>
      </form>

      <p className="invitation-footnote">請填寫報名時的姓名與手機</p>
    </InvitationCard>
  );
}
