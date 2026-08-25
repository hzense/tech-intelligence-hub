'use client';

import { SiteShell } from '@/components/site-shell';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SiteShell>
      <main className="error-state section-shell">
        <div>
          <span className="error-code">500 · TEMPORARY ERROR</span>
          <h1>情报链路暂时中断。</h1>
          <p>页面加载时遇到了临时问题。请重新尝试；如果问题持续存在，我们会通过运行日志继续排查。</p>
          <button className="button button-primary" type="button" onClick={reset}>
            重新加载
          </button>
        </div>
      </main>
    </SiteShell>
  );
}
