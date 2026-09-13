'use client';

import { signIn, signOut } from 'next-auth/react';
import { useState } from 'react';
import styles from './admin-auth.module.css';

function AdminAuthButton({
  action,
  disabled = false,
}: {
  action: 'sign-in' | 'sign-out';
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const signingIn = action === 'sign-in';

  async function handleClick() {
    if (disabled || pending) return;
    setPending(true);
    setFailed(false);
    try {
      if (signingIn) {
        await signIn('google', { callbackUrl: '/admin' });
      } else {
        await signOut({ callbackUrl: '/admin/login' });
      }
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.action}>
      <button
        className={`button ${signingIn ? 'button-primary' : 'button-secondary'} ${styles.button}`}
        type="button"
        disabled={disabled || pending}
        aria-busy={pending}
        onClick={handleClick}
      >
        {pending
          ? signingIn
            ? '正在前往 Google…'
            : '正在退出…'
          : signingIn
            ? '使用 Google 登录'
            : '退出登录'}
      </button>
      {failed ? (
        <p className={styles.notice} role="alert">
          {signingIn ? '暂时无法启动登录，请稍后重试。' : '退出未完成，请稍后重试。'}
        </p>
      ) : null}
    </div>
  );
}

export function GoogleSignInButton({ disabled = false }: { disabled?: boolean }) {
  return <AdminAuthButton action="sign-in" disabled={disabled} />;
}

export function AdminSignOutButton() {
  return <AdminAuthButton action="sign-out" />;
}
