// Datas do Caderneta são sempre strings locais "AAAA-MM-DD" (sem fuso),
// e meses são "AAAA-MM". Isso evita o clássico bug do lançamento que
// "muda de dia" ao converter para UTC.

export const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const WEEKDAYS_SHORT = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

const pad = (n) => String(n).padStart(2, '0');

export function toISODate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO(now = new Date()) {
    return toISODate(now);
}

export function parseISODate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d || 1);
}

export function makeDate(year, month1, day) {
    return `${year}-${pad(month1)}-${pad(day)}`;
}

export function daysInMonth(year, month1) {
    return new Date(year, month1, 0).getDate();
}

/** Dia do mês limitado ao último dia (ex.: dia 31 em fevereiro vira 28/29). */
export function clampedDate(year, month1, day) {
    return makeDate(year, month1, Math.min(day, daysInMonth(year, month1)));
}

export function monthOf(iso) {
    return iso.slice(0, 7);
}

export function splitMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    return { year: y, month: m };
}

export function addMonthsToMonth(ym, n) {
    const { year, month } = splitMonth(ym);
    const total = year * 12 + (month - 1) + n;
    return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Soma meses mantendo o dia desejado (com limite no fim do mês). */
export function addMonths(iso, n, preferredDay) {
    const day = preferredDay ?? Number(iso.slice(8, 10));
    const { year, month } = splitMonth(addMonthsToMonth(monthOf(iso), n));
    return clampedDate(year, month, day);
}

export function addDays(iso, n) {
    const d = parseISODate(iso);
    d.setDate(d.getDate() + n);
    return toISODate(d);
}

export function diffDays(fromIso, toIso) {
    return Math.round((parseISODate(toIso) - parseISODate(fromIso)) / 86400000);
}

export function startOfMonth(ym) {
    return `${ym}-01`;
}

export function endOfMonth(ym) {
    const { year, month } = splitMonth(ym);
    return makeDate(year, month, daysInMonth(year, month));
}

export function monthLabel(ym, { short = false } = {}) {
    const { year, month } = splitMonth(ym);
    return short ? `${MONTH_SHORT[month - 1]}/${String(year).slice(2)}` : `${MONTH_NAMES[month - 1]} ${year}`;
}

/** Lista de meses terminando em `endYm`, do mais antigo para o mais novo. */
export function lastMonths(endYm, count) {
    return Array.from({ length: count }, (_, i) => addMonthsToMonth(endYm, i - count + 1));
}

export function compareISO(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
