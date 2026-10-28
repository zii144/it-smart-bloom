"use client";

import { useState } from "react";
import { RoadTeacherLoginModal } from "@/components/road-teacher-login-modal";
import type { AvatarPortraitSource } from "@/lib/road-teacher-client";
import { isRoadTeacherAvatarUiEnabled } from "@/lib/road-teacher-flags";

/** Shared by live creation and event-day portrait handover. */
export function RoadTeacherAvatarAction(source: AvatarPortraitSource) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!isRoadTeacherAvatarUiEnabled()) return null;
  return (
    <div className="avatar-cta">
      <button
        type="button"
        className="primary-button avatar-button"
        onClick={() => {
          setMessage(null);
          setOpen(true);
        }}
      >
        一鍵替換成路老師系統大頭貼
      </button>
      <p className="avatar-hint">需登入路老師系統帳號，確認由本人替換。</p>
      {message && (
        <p className="avatar-message" role="status">
          {message}
        </p>
      )}
      {open && (
        <RoadTeacherLoginModal
          {...source}
          open
          onCancel={() => setOpen(false)}
          onSuccess={(result) => {
            setOpen(false);
            setMessage(
              result.mock
                ? "開發模擬：已走完替換流程，未真正更新大頭貼。"
                : "已更新路老師系統大頭貼。",
            );
          }}
        />
      )}
    </div>
  );
}
