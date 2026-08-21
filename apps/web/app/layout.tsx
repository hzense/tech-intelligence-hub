import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://hzense.com"),
  title: {
    default: "HZense — Technology Intelligence",
    template: "%s · HZense",
  },
  description:
    "HZense turns fragmented technology signals into structured, versioned intelligence.",
  openGraph: {
    title: "HZense — Technology Intelligence",
    description: "Sense what matters in technology.",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "HZense Technology Intelligence" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "HZense — Technology Intelligence",
    description: "Sense what matters in technology.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/hzense-logo.png",
    shortcut: "/hzense-logo.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
