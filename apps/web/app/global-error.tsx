'use client';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          minHeight: '100vh',
          margin: 0,
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: '#f8f9fc',
          color: '#08152c',
          fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
          textAlign: 'center',
        }}
      >
        <main>
          <strong style={{ color: '#0047ab', letterSpacing: '.14em' }}>HZENSE</strong>
          <h1 style={{ margin: '20px 0 12px', fontSize: 'clamp(2.5rem, 7vw, 5rem)' }}>
            服务暂时不可用
          </h1>
          <p style={{ color: '#5b6780', lineHeight: 1.7 }}>请稍后重试，我们正在恢复情报链路。</p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 20,
              padding: '14px 22px',
              border: 0,
              borderRadius: 14,
              background: '#0047ab',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            重新加载
          </button>
        </main>
      </body>
    </html>
  );
}
