"use client";

import { useId, useState } from "react";
import {
  authErrorMessage,
  isRoadTeacherMockEnabled,
} from "@/lib/road-teacher-auth";
import {
  replaceRoadTeacherAvatar,
  type AvatarReplaceResult,
} from "@/lib/road-teacher-client";

type RoadTeacherLoginModalProps = {
  open: boolean;
  sessionId: string;
  onCancel: () => void;
  onSuccess: (result: AvatarReplaceResult) => void;
};

/**
 * Guest-facing sign-in sheet for the road-teacher avatar replacement.
 * Collects the RT email + password, runs the whole replace flow, and keeps
 * auth errors inline so a typo never closes the sheet. The password lives in
 * local state only and is cleared the moment the flow succeeds.
 */
export function RoadTeacherLoginModal({
  open,
  sessionId,
  onCancel,
  onSuccess,
}: RoadTeacherLoginModalProps) {
  const titleId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const result = await replaceRoadTeacherAvatar({
        sessionId,
        email,
        password,
      });
      setPassword("");
      onSuccess(result);
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rt-login-backdrop" role="presentation">
      <div
        className="rt-login-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="rt-login-header">
          <p className="eyebrow">路老師系統</p>
          <h2 id={titleId}>登入後替換大頭貼</h2>
          <p>
            以路老師系統的帳號密碼登入，確認由本人替換。密碼只會送往路老師系統驗證，不會經過或保存在本服務。
          </p>
        </header>

        {isRoadTeacherMockEnabled() && (
          <p className="rt-login-mock-note">
            開發模擬：不會真的連到路老師系統。6 碼以上任意密碼可通過；輸入
            wrong 可測試失敗畫面。
          </p>
        )}

        <form
          className="rt-login-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="rt-login-field">
            <span>電子郵件 Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="username"
              inputMode="email"
              disabled={busy}
            />
          </label>

          <label className="rt-login-field">
            <span>密碼 Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              disabled={busy}
            />
          </label>

          {error && <p className="rt-login-error">{error}</p>}

          <div className="rt-login-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onCancel}
              disabled={busy}
            >
              取消
            </button>
            <button
              type="submit"
              className="primary-button"
              disabled={busy || !email.trim() || !password}
            >
              {busy ? "登入並替換中…" : "登入並替換"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
