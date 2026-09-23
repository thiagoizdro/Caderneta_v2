import { Moon, Search, Sun } from 'lucide-react';
import { useState } from 'react';
import { navigate, useUI } from '../state.jsx';
import { SyncPill } from './ui.jsx';

// ------------------------------------------------------------
// Tema
// ------------------------------------------------------------

function readTheme() {
    try {
        return localStorage.getItem('caderneta:theme');
    } catch {
        return null;
    }
}

export function currentTheme() {
    const saved = readTheme();
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme) {
    try {
        if (theme === 'system') localStorage.removeItem('caderneta:theme');
        else localStorage.setItem('caderneta:theme', theme);
    } catch {
        // sem armazenamento: vale só nesta sessão
    }
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', currentTheme() === 'dark' ? '#151A20' : '#233A2E');
}

function ThemeToggle() {
    const [theme, setTheme] = useState(currentTheme);
    const next = theme === 'dark' ? 'light' : 'dark';
    return (
        <button
            className="btn-icon"
            onClick={() => { applyTheme(next); setTheme(next); }}
            aria-label={next === 'dark' ? 'Usar tema escuro' : 'Usar tema claro'}
            title={next === 'dark' ? 'Tema escuro' : 'Tema claro'}
        >
            {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        </button>
    );
}

export function Topbar({ eyebrow, title, children }) {
    const ui = useUI();
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
    return (
        <header className="topbar">
            <div className="topbar-title">
                {eyebrow && <span className="eyebrow">{eyebrow}</span>}
                <h1>{title}</h1>
            </div>
            <div className="topbar-actions">
                {children}
                <button className="search-trigger" onClick={ui.openSearch}>
                    <Search size={16} aria-hidden="true" /> Buscar
                    <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
                </button>
                <button className="btn-icon search-icon-btn" onClick={ui.openSearch} aria-label="Buscar"><Search size={19} /></button>
                <SyncPill onClick={() => navigate('/ajustes', { secao: 'conta' })} />
                <ThemeToggle />
            </div>
        </header>
    );
}
