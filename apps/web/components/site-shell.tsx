import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "./theme-toggle";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="site-frame">
      <header className="site-header">
        <div className="section-shell header-inner">
          <Link className="brand" href="/" aria-label="HZense 首页">
            <Image
              src="/hzense-logo.png"
              width={44}
              height={44}
              alt=""
              priority
              unoptimized
            />
            <span><strong>HZense</strong><small>科技情报</small></span>
          </Link>
          <nav aria-label="主导航">
            <Link href="/daily">每日简报</Link>
            <Link href="/weekly">周报</Link>
            <Link href="/insights">洞察</Link>
            <Link href="/topics">专题</Link>
            <Link href="/signals">信号</Link>
            <Link href="/#radar">雷达</Link>
          </nav>
          <div className="header-actions">
            <ThemeToggle />
            <a className="ask-link" href="mailto:hello@hzense.com">联系 HZense <span>↗</span></a>
          </div>
        </div>
      </header>
      {children}
      <footer className="site-footer">
        <div className="section-shell footer-inner">
          <div>
            <strong>HZense</strong>
            <span>感知科技的变化</span>
          </div>
          <p>结构化信号，关联证据，更清晰的决策。</p>
          <span>© 2026 HZense</span>
        </div>
      </footer>
    </div>
  );
}
