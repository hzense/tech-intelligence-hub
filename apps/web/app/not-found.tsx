import Link from 'next/link';
import { SiteShell } from '@/components/site-shell';

export default function NotFound() {
  return (
    <SiteShell>
      <main className="error-state section-shell">
        <div>
          <span className="error-code">404 · NOT FOUND</span>
          <h1>这个页面还没有形成情报。</h1>
          <p>链接可能已经失效，或者内容尚未发布。你可以返回首页，继续查看最新的科技信号。</p>
          <Link className="button button-primary" href="/">
            返回 HZense 首页
          </Link>
        </div>
      </main>
    </SiteShell>
  );
}
