export type GuestIdentity =
  | { kind: "lineId"; value: string }
  | { kind: "mobile"; value: string };

/** 路老師通用 Line ID：數字-中文姓名-地區，例如 112-張小明-南投縣 */
const LINE_ID_PATTERN = /^\d+-.+-.+$/u;
/** 台灣門號：09 開頭共 10 碼 */
const MOBILE_PATTERN = /^09\d{8}$/;

export function normalizeLineId(raw: string) {
  return raw.trim().replace(/\s+/g, "");
}

export function normalizeMobile(raw: string) {
  return raw.trim().replace(/[\s-]/g, "");
}

export function isValidLineId(value: string) {
  return LINE_ID_PATTERN.test(value);
}

export function isValidMobile(value: string) {
  return MOBILE_PATTERN.test(value);
}

/**
 * Guests provide exactly one identifier. Empty strings are treated as absent so
 * the form can expose both fields without requiring the unused one.
 */
export function parseGuestIdentity(input: {
  lineId?: unknown;
  mobile?: unknown;
}): GuestIdentity {
  const lineId =
    typeof input.lineId === "string" ? normalizeLineId(input.lineId) : "";
  const mobile =
    typeof input.mobile === "string" ? normalizeMobile(input.mobile) : "";

  if (lineId && mobile) {
    throw new IdentityError("請只填寫 Line ID 或手機號碼其中一項。");
  }

  if (!lineId && !mobile) {
    throw new IdentityError("請填寫路老師通用 Line ID 或手機號碼。");
  }

  if (lineId) {
    if (!isValidLineId(lineId)) {
      throw new IdentityError(
        "Line ID 格式需為「數字-姓名-地區」，例如 112-張小明-南投縣。",
      );
    }
    return { kind: "lineId", value: lineId };
  }

  if (!isValidMobile(mobile)) {
    throw new IdentityError("請輸入台灣手機號碼，例如 0912345678。");
  }

  return { kind: "mobile", value: mobile };
}

/** Safe Storage / Firestore path segment for an identity value. */
export function identityStorageKey(identity: GuestIdentity) {
  return `${identity.kind}_${identity.value.replace(/[^\w\u4e00-\u9fff-]/gu, "_")}`;
}

export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityError";
  }
}
