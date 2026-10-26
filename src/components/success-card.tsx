import Image from "next/image";
import Link from "next/link";
import {
  ArrowIcon,
  CelebrationSeal,
  InvitationCard,
  InvitationDetails,
  InvitationOverline,
  InvitationRule,
  InvitationSignature,
} from "@/components/invitation";

/**
 * Confirms a submission. The portrait is deliberately not shown here: guests
 * collect it after checking in on the event day.
 */
export type SuccessView =
  | {
      kind: "ready";
      guestName: string | null;
      seat: string;
      rundownUrl: string;
      rundownQrDataUrl: string;
    }
  | { kind: "expired" }
  | { kind: "missing" };

function LapsedCard({ kind }: { kind: "expired" | "missing" }) {
  return (
    <InvitationCard className="celebration-card" labelledBy="success-title">
      <InvitationOverline />
      <InvitationRule />
      <h1 id="success-title" className="celebration-title">
        <span className="celebration-greeting">
          {kind === "expired" ? "這個連結已經過期" : "找不到這份資料"}
        </span>
      </h1>
      <p className="invitation-title-sub">歡迎回到邀請卡重新開始</p>
      <InvitationRule />
      <InvitationDetails />
      <Link className="primary-button invitation-button" href="/">
        回到邀請卡
        <span className="button-arrow">
          <ArrowIcon />
        </span>
      </Link>
    </InvitationCard>
  );
}

export function SuccessCard({ view }: { view: SuccessView }) {
  if (view.kind !== "ready") return <LapsedCard kind={view.kind} />;

  return (
    <InvitationCard className="celebration-card" labelledBy="success-title">
      <InvitationOverline />
      <InvitationRule />
      <CelebrationSeal />
      <h1 id="success-title" className="celebration-title">
        {view.guestName ? (
          <span className="celebration-name">{view.guestName}</span>
        ) : null}
        <span className="celebration-greeting">照片已經收到</span>
      </h1>
      <p className="invitation-title-sub">活動當天報到後，即可領取您的似顏繪</p>
      <InvitationRule />

      <div className="celebration-body">
        <InvitationDetails>
          {view.seat ? (
            <div>
              <dt>座位</dt>
              <dd className="celebration-seat">{view.seat}</dd>
            </div>
          ) : null}
        </InvitationDetails>

        <figure className="celebration-share">
          <Image
            src={view.rundownQrDataUrl}
            alt="活動流程 QR Code"
            width={320}
            height={320}
            unoptimized
            loading="eager"
          />
          <figcaption>掃描查看活動流程</figcaption>
          <div className="celebration-share-links">
            <a href={view.rundownUrl} target="_blank" rel="noopener noreferrer">
              開啟活動流程
            </a>
          </div>
        </figure>
      </div>

      <InvitationSignature>期待與您相見</InvitationSignature>
      <Link className="primary-button invitation-button" href="/">
        完成
        <span className="button-arrow">
          <ArrowIcon />
        </span>
      </Link>
      <p className="invitation-footnote">為您留一席溫柔的光</p>
    </InvitationCard>
  );
}
