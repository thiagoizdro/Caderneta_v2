import { MONTH_SHORT, diffDays, parseISODate, todayISO } from './dates.js';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const BRL_COMPACT = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
const PERCENT = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });

export function money(value) {
    return BRL.format(Number(value) || 0).replace(/ /g, ' ').replace(/^-/, '− ');
}

export function moneyCompact(value) {
    const v = Number(value) || 0;
    return Math.abs(v) < 1000 ? money(Math.round(v)).replace(',00', '') : BRL_COMPACT.format(v).replace(/00a0/g, ' ');
}

export function signedMoney(value) {
    const v = Number(value) || 0;
    return `${v < 0 ? '− ' : v > 0 ? '+ ' : ''}${money(Math.abs(v))}`;
}

export function percent(ratio) {
    return PERCENT.format(Number.isFinite(ratio) ? ratio : 0);
}

/** "12 set" ou "12 set 2025" quando é de outro ano. */
export function shortDate(iso, today = todayISO()) {
    const d = parseISODate(iso);
    const base = `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
    return iso.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${d.getFullYear()}`;
}

export function capitalize(text) {
    return text ? text[0].toUpperCase() + text.slice(1) : text;
}

export function longDate(iso) {
    return parseISODate(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function relativeDay(iso, today = todayISO()) {
    const diff = diffDays(today, iso);
    if (diff === 0) return 'Hoje';
    if (diff === 1) return 'Amanhã';
    if (diff === -1) return 'Ontem';
    if (diff > 1 && diff < 7) return `Em ${diff} dias`;
    return shortDate(iso, today);
}

/** Converte texto digitado ("1.234,56", "12,5", "12.5") em número. */
export function parseAmount(input) {
    if (typeof input === 'number') return input;
    const raw = String(input ?? '').trim().replace(/[R$\s]/g, '');
    if (!raw) return NaN;
    const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
    return Number(normalized);
}

export function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}
