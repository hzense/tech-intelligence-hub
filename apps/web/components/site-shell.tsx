import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "./theme-toggle";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="site-frame">
      <header className="site-header">
        <div className="section-shell header-inner">
          <Link className="brand" href="/" aria-label="HZense home">
            <Image src="/hzense-logo.png" width={44} height={44} alt="" priority />
            <span><strong>HZense</strong><small>Technology Intelligence</small></span>
          </Link>
          <nav aria-label="Primary navigation">
            <Link href="/daily">Daily</Link>
            <Link href="/#intelligence">Insights</Link>
            <Link href="/#radar">Radar</Link>
            <span className="nav-muted">Topics</span>
          </nav>
          <div className="header-actions">
            <ThemeToggle />
            <a className="ask-link" href="mailto:hello@hzense.com">Ask HZense <span>↗</span></a>
          </div>
        </div>
      </header>
      {children}
      <footer className="site-footer">
        <div className="section-shell footer-inner">
          <div>
            <strong>HZense</strong>
            <span>Sense what matters in technology.</span>
          </div>
          <p>Structured signals. Connected evidence. Clearer decisions.</p>
          <span>© 2026 HZense</span>
        </div>
      </footer>
    </div>
  );
}
