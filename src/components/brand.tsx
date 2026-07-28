import Image from "next/image";
import bloomLogo from "@/app/icon.png";

export function BloomMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="智晟｜綻放">
      <Image
        src={bloomLogo}
        alt=""
        className="brand-mark"
        aria-hidden="true"
      />
      {!compact && (
        <span className="brand-name">
          智晟｜<strong>綻放</strong>
        </span>
      )}
    </div>
  );
}
