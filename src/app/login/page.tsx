'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export default function LoginPage() {
  // Stint 61 — username + password. Username is sent lower-cased so users
  // don't have to remember the exact case of their AUTH_USERS entry.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
    });
    setLoading(false);
    if (res.ok) router.push('/');
    else setError('Invalid credentials');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas p-6 relative overflow-hidden">
      {/* soft brand glow in the corner */}
      <div
        aria-hidden
        className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full opacity-20 pointer-events-none"
        style={{
          background: 'radial-gradient(closest-side, rgba(232,38,76,0.30), transparent 70%)',
        }}
      />
      <div className="relative bg-surface border border-border rounded-xl shadow-lg p-8 w-full max-w-[380px] animate-fadeInScale">
        <div className="mb-6">
          <Logo />
        </div>
        <h1 className="text-lg font-semibold text-ink tracking-tight">Sign in</h1>
        <p className="text-sm text-ink-muted mt-1 mb-6">
          Luxembourg tax &amp; compliance, in one workspace.
          <br />
          <span className="text-ink-faint">AI reads, humans review.</span>
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="text-sm text-danger-700 bg-danger-50 border border-[#F4B9B7] rounded-md px-3 py-2 animate-fadeIn">
              {error}
            </div>
          )}
          <Input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
          <Input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
          />
          <Button type="submit" variant="primary" loading={loading} className="w-full justify-center h-9">
            Sign in
          </Button>
        </form>
        <div className="mt-6 pt-4 border-t border-border text-center">
          <a
            href="https://cifracompliance.com"
            className="text-2xs text-ink-faint hover:text-ink-muted transition-colors"
          >
            ← cifracompliance.com
          </a>
        </div>
      </div>
    </div>
  );
}
