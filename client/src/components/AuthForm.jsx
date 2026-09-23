import { useState } from 'react';
import { login, register } from '../lib/sync.js';

export function AuthForm({ initialMode = 'login', onDone }) {
    const [mode, setMode] = useState(initialMode);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    async function submit(e) {
        e.preventDefault();
        setError('');
        if (!navigator.onLine) return setError('Você está offline. Conecte-se para entrar na sua conta.');
        setBusy(true);
        try {
            if (mode === 'login') await login(email.trim(), password);
            else await register(name.trim(), email.trim(), password);
            onDone?.();
        } catch (err) {
            setError(err.message || 'Não foi possível concluir.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <form onSubmit={submit} noValidate>
            <div className="segmented" role="tablist">
                <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Entrar</button>
                <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Criar conta</button>
            </div>
            {mode === 'register' && (
                <div className="field mt">
                    <label className="label" htmlFor="auth-name">Seu nome</label>
                    <input id="auth-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
                </div>
            )}
            <div className="field mt">
                <label className="label" htmlFor="auth-email">E-mail</label>
                <input id="auth-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </div>
            <div className="field">
                <label className="label" htmlFor="auth-pass">Senha</label>
                <input
                    id="auth-pass"
                    type="password"
                    className="input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    minLength={8}
                    required
                />
                {mode === 'register' && <span className="hint">Pelo menos 8 caracteres.</span>}
            </div>
            {error && <div className="callout danger mt" role="alert">{error}</div>}
            <button type="submit" className="btn btn-primary btn-block mt" disabled={busy}>
                {busy ? 'Aguarde…' : mode === 'login' ? 'Entrar e sincronizar' : 'Criar conta e sincronizar'}
            </button>
            <p className="hint center mt">Os dados deste aparelho são enviados para a sua conta e ficam disponíveis no celular e no computador.</p>
        </form>
    );
}
