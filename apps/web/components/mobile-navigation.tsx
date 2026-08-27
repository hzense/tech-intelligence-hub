"use client";

import Link from "next/link";
import { useState } from "react";

const navigationItems = [
  { href: "/daily", label: "每日简报" },
  { href: "/weekly", label: "周报" },
  { href: "/insights", label: "洞察" },
  { href: "/topics", label: "专题" },
  { href: "/signals", label: "信号" },
  { href: "/resources", label: "资源" },
  { href: "/radar", label: "雷达" },
  { href: "/search", label: "搜索" },
] as const;

export function MobileNavigation() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mobile-navigation">
      <button
        className="mobile-menu-toggle"
        type="button"
        aria-label={isOpen ? "关闭主导航" : "打开主导航"}
        aria-expanded={isOpen}
        aria-controls="mobile-menu"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="mobile-menu-icon" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </button>
      <div className="mobile-menu" id="mobile-menu" hidden={!isOpen}>
        <nav className="mobile-menu-nav" aria-label="移动导航">
          {navigationItems.map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setIsOpen(false)}>
              {item.label}
            </Link>
          ))}
        </nav>
        <a className="mobile-menu-contact" href="mailto:hello@hzense.com">
          联系 HZense <span aria-hidden="true">↗</span>
        </a>
      </div>
    </div>
  );
}
