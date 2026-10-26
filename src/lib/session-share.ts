import QRCode from "qrcode";

/** APP_BASE_URL wins so QR codes point at the public host, not a proxy hop. */
export function shareBaseUrl(requestOrigin: string) {
  const configured = process.env.APP_BASE_URL?.trim();
  return (configured || requestOrigin).replace(/\/+$/, "");
}

export function sessionShareUrl(baseUrl: string, sessionId: string) {
  return `${baseUrl}/s/${sessionId}`;
}

/** QR in the booth's ink-on-paper colours, for any link we show guests. */
export function brandedQrDataUrl(url: string) {
  return QRCode.toDataURL(url, {
    width: 640,
    margin: 2,
    color: {
      dark: "#142c22",
      light: "#fffdf7",
    },
    errorCorrectionLevel: "M",
  });
}
