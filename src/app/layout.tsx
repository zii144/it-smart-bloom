import type { Metadata, Viewport } from "next";
import { FlowerRain } from "@/components/flower-rain";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "智晟｜綻放 — 路老師似顏繪",
    template: "%s｜智晟・綻放",
  },
  description:
    "路老師似顏繪：拍下一張照片，把一路走來的光，畫成你獨一無二的模樣。",
};

export const viewport: Viewport = {
  themeColor: "#f7f0e3",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant-TW">
      <body>
        {children}
        <FlowerRain />
      </body>
    </html>
  );
}
