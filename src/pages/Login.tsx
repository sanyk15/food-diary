import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';

type Mode = 'signin' | 'signup';

const MIN_PASSWORD = 6;

export default function Login() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPassword('');
    setPassword2('');
    setPendingEmail(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanEmail = email.trim();

    if (mode === 'signup') {
      if (password.length < MIN_PASSWORD) {
        setError(`Пароль должен быть не короче ${MIN_PASSWORD} символов.`);
        return;
      }
      if (password !== password2) {
        setError('Пароли не совпадают.');
        return;
      }
      setBusy(true);
      const result = await signUp(cleanEmail, password, inviteCode);
      setBusy(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.needsConfirmation) setPendingEmail(cleanEmail);
      return;
    }

    setBusy(true);
    const { error: signInError } = await signIn(cleanEmail, password);
    setBusy(false);
    if (signInError) setError(signInError);
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-logo">🍽</div>
          <h1>Дневник питания</h1>
          <p className="login-sub">
            Supabase не настроен. Скопируй <code>.env.example</code> в <code>.env.local</code> и
            подставь URL и publishable-ключ проекта.
          </p>
        </div>
      </div>
    );
  }

  if (pendingEmail) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-logo">📧</div>
          <h1>Подтверди email</h1>
          <p className="login-sub">
            Письмо ушло на <b>{pendingEmail}</b>. Перейди по ссылке и вернись сюда.
          </p>
          <button className="btn btn-ghost" onClick={() => switchMode('signin')}>
            Ко входу
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo">🍽</div>
        <h1>Дневник питания</h1>
        <p className="login-sub">Примерный подсчёт КБЖУ по описанию еды</p>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>

        <label className="field">
          <span>Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
          />
        </label>

        {mode === 'signup' && (
          <>
            <label className="field">
              <span>Пароль ещё раз</span>
              <input
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label className="field">
              <span>Код приглашения</span>
              <input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                autoComplete="off"
              />
            </label>
          </>
        )}

        {error && <div className="form-error">{error}</div>}

        <button className="btn btn-primary btn-wide" type="submit" disabled={busy}>
          {busy ? 'Подожди…' : mode === 'signin' ? 'Войти' : 'Зарегистрироваться'}
        </button>

        <button
          type="button"
          className="login-switch"
          onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          {mode === 'signin' ? 'Есть код приглашения? Зарегистрироваться' : 'У меня уже есть аккаунт'}
        </button>
      </form>
    </div>
  );
}
