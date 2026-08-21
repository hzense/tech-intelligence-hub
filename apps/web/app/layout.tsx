import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://hzense.com"),
  title: {
    default: "HZense — 科技情报",
    template: "%s · HZense",
  },
  description:
    "HZense 将分散的科技信号转化为结构化、可追溯的科技情报。",
  openGraph: {
    title: "HZense — 科技情报",
    description: "感知科技的变化",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "HZense 科技情报" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "HZense — 科技情报",
    description: "感知科技的变化",
    images: ["/og.png"],
  },
  icons: {
    icon: "/hzense-logo.png",
    shortcut: "/hzense-logo.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
