import {
    ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Cloud, CloudOff, Info, RefreshCw, TrendingDown, TrendingUp, X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { addMonthsToMonth, monthLabel } from '../lib/dates.js';
import { money, percent } from '../lib/format.js';
import { useSyncState } from '../state.jsx';
import { Icon, seriesColor } from './Icon.jsx';

// ------------------------------------------------------------
// Modal: folha deslizante no celular, diálogo no desktop
// ------------------------------------------------------------

export function Modal({ title, onClose, children, footer, wide = false, labelledBy }) {
    const ref = useRef(null);

    useEffect(() => {
        const previous = document.activeElement;
        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Tab' && ref.current) {
                const focusables = ref.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
                if (!focusables.length) return;
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
                else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
            }
        };
        document.addEventListener('keydown', onKey);
        document.body.style.overflow = 'hidden';
        const autofocus = ref.current?.querySelector('[autofocus], [data-autofocus]');
        (autofocus || ref.current)?.focus({ preventScroll: true });
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = '';
            previous?.focus?.({ preventScroll: true });
        };
    }, [onClose]);

    return (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={labelledBy ? undefined : title} ref={ref} tabIndex={-1}>
                <div className="sheet-handle" aria-hidden="true" />
                <div className="sheet-head">
                    <h2>{title}</h2>
                    <button className="btn-icon sm" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
                </div>
                {children}
                {footer && <div className="sheet-foot">{footer}</div>}
            </div>
        </div>
    );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false, onResult, extra }) {
    return (
        <Modal
            title={title}
            onClose={() => onResult(false)}
            footer={(
                <>
                    <button className="btn btn-secondary" onClick={() => onResult(false)}>Cancelar</button>
                    {extra}
                    <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => onResult(true)} data-autofocus>{confirmLabel}</button>
                </>
            )}
        >
            {message && <p className="soft">{message}</p>}
        </Modal>
    );
}

// ------------------------------------------------------------
// Toasts
// ------------------------------------------------------------

export function Toasts({ items, onDismiss }) {
    const icons = { success: CircleCheck, error: CircleAlert, warn: CircleAlert, info: Info };
    return (
        <div className="toasts" role="status" aria-live="polite">
            {items.map((t) => {
                const I = icons[t.type] || Info;
                return (
                    <div key={t.id} className={`toast ${t.type}`}>
                        <I size={18} aria-hidden="true" />
                        <span>{t.message}</span>
                        {t.action && (
                            <button className="toast-action" onClick={() => { t.action.run(); onDismiss(t.id); }}>{t.action.label}</button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ------------------------------------------------------------
// Pequenos blocos
// ------------------------------------------------------------

export function EmptyState({ icon = 'receipt', title, children, action }) {
    return (
        <div className="empty">
            <div className="empty-icon"><Icon name={icon} size={24} /></div>
            <h3>{title}</h3>
            {children && <p>{children}</p>}
            {action}
        </div>
    );
}

export function Progress({ ratio, level, color, large = false, label }) {
    const pct = Math.max(0, Math.min(1, ratio || 0)) * 100;
    return (
        <div
            className={`progress${large ? ' lg' : ''}${level && level !== 'ok' ? ` ${level}` : ''}`}
            style={color ? { '--c': color } : undefined}
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={label}
        >
            <span style={{ width: `${pct}%` }} />
        </div>
    );
}

export function CategoryIcon({ category, size = '' }) {
    return (
        <span className={`cat-icon${size ? ` ${size}` : ''}`} style={{ '--c': category ? seriesColor(category.color) : undefined }} aria-hidden="true">
            <Icon name={category?.icon || 'tag'} size={size === 'sm' ? 15 : size === 'lg' ? 22 : 18} />
        </span>
    );
}

export function MonthPicker({ value, onChange, max }) {
    return (
        <div className="month-picker">
            <button className="btn-icon sm" onClick={() => onChange(addMonthsToMonth(value, -1))} aria-label="Mês anterior"><ChevronLeft size={18} /></button>
            <span aria-live="polite">{monthLabel(value)}</span>
            <button className="btn-icon sm" onClick={() => onChange(addMonthsToMonth(value, 1))} disabled={max && value >= max} aria-label="Próximo mês"><ChevronRight size={18} /></button>
        </div>
    );
}

/** Variação percentual. `goodWhenUp` inverte a cor (despesa subir é ruim). */
export function Delta({ current, previous, goodWhenUp = true }) {
    if (!previous) return null;
    const r = current / previous - 1;
    if (!Number.isFinite(r)) return null;
    const flat = Math.abs(r) < 0.005;
    const good = flat ? null : (r > 0) === goodWhenUp;
    const I = r >= 0 ? TrendingUp : TrendingDown;
    return (
        <span className={`delta ${flat ? 'flat' : good ? 'good' : 'bad'}`} title="Comparado ao mês anterior">
            {!flat && <I size={12} aria-hidden="true" />}
            {flat ? '=' : percent(Math.abs(r))}
        </span>
    );
}

/** Valor em reais com contagem animada (respeita "reduzir movimento"). */
export function AnimatedMoney({ value, className = '' }) {
    const [shown, setShown] = useState(value);
    const from = useRef(value);

    useEffect(() => {
        const start = from.current;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (reduce || Math.abs(value - start) < 0.005) {
            setShown(value);
            from.current = value;
            return undefined;
        }
        let raf;
        const t0 = performance.now();
        const tick = (now) => {
            const p = Math.min((now - t0) / 550, 1);
            const eased = 1 - (1 - p) ** 3;
            const v = start + (value - start) * eased;
            setShown(v);
            from.current = v;
            if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [value]);

    return <span className={`num ${className}`}>{money(shown)}</span>;
}

export function SyncPill({ onClick }) {
    const s = useSyncState();
    const map = {
        local: { icon: CloudOff, text: 'Só neste aparelho', short: 'Local' },
        syncing: { icon: RefreshCw, text: 'Sincronizando…', short: 'Sincronizando', spin: true },
        synced: { icon: Cloud, text: 'Sincronizado', short: 'Sincronizado' },
        offline: { icon: CloudOff, text: s.pending ? `Offline · ${s.pending} pendente${s.pending > 1 ? 's' : ''}` : 'Offline', short: 'Offline' },
        error: { icon: CircleAlert, text: 'Erro ao sincronizar', short: 'Erro' },
        expired: { icon: CircleAlert, text: 'Entre novamente', short: 'Sessão' },
    };
    const m = map[s.status] || map.local;
    const I = m.icon;
    return (
        <button className={`sync-pill ${s.status}`} onClick={onClick} title={s.error || m.text} aria-label={m.text}>
            <I size={14} className={m.spin ? 'spin' : ''} aria-hidden="true" />
            <span className="label-full" aria-hidden="true">{m.text}</span>
        </button>
    );
}
