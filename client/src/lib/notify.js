// Lembretes locais: disparados quando o app é aberto (ou volta ao primeiro
// plano), no máximo uma vez por dia para cada assunto.

import { addDays, todayISO } from './dates.js';
import { money } from './format.js';
import { budgetStatus, upcomingCommitments } from './finance.js';

const KEY = 'caderneta:notified';

export function notificationsSupported() {
    return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationsEnabled() {
    return notificationsSupported() && Notification.permission === 'granted';
}

export async function requestNotifications() {
    if (!notificationsSupported()) return 'unsupported';
    return Notification.requestPermission();
}

async function show(title, body, tag) {
    if (!notificationsEnabled()) return;
    const options = { body, tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' };
    try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) return reg.showNotification(title, options);
    } catch {
        // cai para a API direta
    }
    new Notification(title, options);
}

function once(tag) {
    let seen = {};
    try {
        seen = JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch {
        // ignora
    }
    const today = todayISO();
    if (seen[tag] === today) return false;
    seen[tag] = today;
    for (const k of Object.keys(seen)) if (seen[k] < addDays(today, -7)) delete seen[k];
    try {
        localStorage.setItem(KEY, JSON.stringify(seen));
    } catch {
        // ignora
    }
    return true;
}

export function runDailyReminders({ accounts, txs, recurrences, categories, settings }) {
    if (!notificationsEnabled()) return;
    const today = todayISO();

    const soon = upcomingCommitments({ accounts, txs, recurrences, today, days: 2 }).filter((i) => i.type === 'expense');
    if (soon.length && once('upcoming')) {
        const total = soon.reduce((a, i) => a + i.amount, 0);
        show('Contas chegando', `${soon.map((i) => i.description).slice(0, 3).join(', ')} — ${money(total)} nos próximos 2 dias.`, 'upcoming');
    }

    for (const b of budgetStatus(categories, txs, today.slice(0, 7))) {
        if (b.level !== 'ok' && once(`budget-${b.category.id}-${b.level}`)) {
            show('Orçamento', b.level === 'over'
                ? `Você ultrapassou o orçamento de ${b.category.name}.`
                : `${b.category.name} já usou ${Math.round(b.ratio * 100)}% do orçamento do mês.`, `budget-${b.category.id}`);
        }
    }

    if (settings?.mode === 'daily' && new Date().getHours() >= 18) {
        const marked = txs.some((t) => t.source === 'workday' && t.date === today);
        if (!marked && once('workday')) show('Caderneta', 'Trabalhou hoje? Marque o dia no calendário.', 'workday');
    }
}

export function budgetAlertFor(categories, txs, categoryId, month) {
    const b = budgetStatus(categories, txs, month).find((s) => s.category.id === categoryId);
    if (!b || b.level === 'ok') return null;
    return b;
}
