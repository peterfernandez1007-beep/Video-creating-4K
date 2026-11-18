import { useState } from 'react';
import { api } from '../lib/api';
import type { Language, UserProfile } from '../types/studio';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  user: UserProfile | null;
  language: Language;
  onSuccess: () => Promise<void>;
}

export function AuthModal({ open, onClose, user, language, onSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    try {
      if (mode === 'login') {
        await api.login(email, password);
      } else {
        await api.register(email, name, password, language);
      }
      await onSuccess();
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl bg-[#12151F] border border-white/10 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-white">Studio Account</h2>
          <button onClick={onClose} className="text-xs text-slate-400 hover:text-white">
            Close
          </button>
        </div>

        {user && (
          <div className="p-3 rounded-lg bg-[#090A0F] border border-white/8 flex items-center justify-between text-xs">
            <div>
              <div className="font-semibold text-white">{user.name}</div>
              <div className="text-slate-400">
                {user.email} · {user.role}
              </div>
            </div>
            <button
              onClick={async () => {
                await api.logout();
                await onSuccess();
              }}
              className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 text-slate-200"
            >
              Sign Out
            </button>
          </div>
        )}

        <div className="flex gap-1 p-1 bg-[#090A0F] rounded-lg border border-white/8 text-xs">
          <button
            onClick={() => setMode('login')}
            className={`flex-1 py-1.5 rounded font-medium ${
              mode === 'login' ? 'bg-indigo-600 text-white' : 'text-slate-400'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => setMode('register')}
            className={`flex-1 py-1.5 rounded font-medium ${
              mode === 'register' ? 'bg-indigo-600 text-white' : 'text-slate-400'
            }`}
          >
            Create Account
          </button>
        </div>

        {errorMsg && (
          <div className="p-2.5 rounded bg-rose-950/50 border border-rose-500/30 text-xs text-rose-200">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          {mode === 'register' && (
            <div>
              <label className="block text-slate-400 mb-1">Full Name</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-white"
              />
            </div>
          )}
          <div>
            <label className="block text-slate-400 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="studio@aivideostudio.local"
              className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg bg-[#090A0F] border border-white/10 px-3 py-2 text-white"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold"
          >
            {busy ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Creator Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
