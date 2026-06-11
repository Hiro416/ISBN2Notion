import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "ISBN2Notion",
  description: "ISBNバーコードからNotionへ本を登録する個人用PWA",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "ISBN2Notion",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f8f6",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        {children}
        <Script src="https://storage.ko-fi.com/cdn/scripts/overlay-widget.js" strategy="afterInteractive" />
        <Script id="kofi-widget" strategy="afterInteractive">
          {`
            (function drawKofiWidget() {
              if (window.__isbn2notionKofiLoaded) {
                return;
              }

              if (!window.kofiWidgetOverlay) {
                window.setTimeout(drawKofiWidget, 300);
                return;
              }

              window.__isbn2notionKofiLoaded = true;
              window.kofiWidgetOverlay.draw('hayahiro', {
                'type': 'floating-chat',
                'floating-chat.donateButton.text': 'Tip Me',
                'floating-chat.donateButton.background-color': '#ffffff',
                'floating-chat.donateButton.text-color': '#323842'
              });
            })();
          `}
        </Script>
      </body>
    </html>
  );
}
