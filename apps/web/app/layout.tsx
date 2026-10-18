import type { Metadata } from 'next';
import { isLocalDevelopment } from '@/lib/local-development';
import './globals.css';

const localDevelopment = isLocalDevelopment();

const localPreview =
  process.env.HZENSE_LOCAL_PREVIEW === '1' &&
  process.env.NODE_ENV === 'development' &&
  process.env.VERCEL_ENV === 'development' &&
  !process.env.VERCEL;

const themeInitializationScript = `
  (function () {
    try {
      var stored = window.localStorage.getItem("hzense-theme");
      var dark = stored
        ? stored === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    } catch (_) {
      document.documentElement.dataset.theme = "light";
    }
  })();
`;

export const metadata: Metadata = {
  metadataBase: new URL('https://hzense.com'),
  title: {
    default: 'HZense — 科技情报',
    template: '%s · HZense',
  },
  description: 'HZense 将分散的科技信号转化为结构化、可追溯的科技情报。',
  ...(localPreview || localDevelopment ? { robots: { index: false, follow: false } } : {}),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    url: '/',
    title: 'HZense — 科技情报',
    description: '感知科技的变化',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'HZense 科技情报' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'HZense — 科技情报',
    description: '感知科技的变化',
    images: ['/og.png'],
  },
  icons: {
    icon: '/hzense-logo.png',
    shortcut: '/hzense-logo.png',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializationScript }} />
      </head>
      <body>
        {localDevelopment ? (
          <aside className="local-preview-notice" aria-label="本地开发说明">
            <strong>本地开发环境</strong>
            <span>
              使用本地数据库；AI 为模拟结果。发布仅本地可见，不会同步生产，也不会产生 AI 费用。
            </span>
          </aside>
        ) : null}
        {localPreview ? (
          <aside className="local-preview-notice" aria-label="本地版本说明">
            <strong>本地浏览版</strong>
            <span>使用仓库内容快照，非生产数据库实时数据。导入、AI 生成和发布暂不可用。</span>
          </aside>
        ) : null}
        {children}
      </body>
    </html>
  );
}
