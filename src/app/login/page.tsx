'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.push('/');
    } else {
      setError('Contrasena incorrecta');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white border rounded-lg p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-[#1a1a2e] mb-1">Luxembourg VAT Platform</h1>
        <p className="text-sm text-gray-500 mb-6">Introduce la contrasena para acceder</p>
        <form onSubmit={handleSubmit}>
          {error && <div className="text-red-600 text-sm mb-3 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Contrasena"
            className="w-full border rounded px-3 py-2 text-sm mb-4"
            autoFocus
          />
          <button type="submit"
            className="w-full bg-[#1a1a2e] text-white py-2 rounded text-sm font-semibold hover:bg-[#2a2a4e]">
            Entrar
          </button>
        </form>
      </div>
    </div>
  );
}
