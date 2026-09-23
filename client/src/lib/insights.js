// "Insights do Caderneta": frases geradas por regras e cálculos sobre os
// dados do próprio usuário. Cada regra devolve zero ou mais insights; a tela
// mostra os mais relevantes primeiro (peso maior = mais importante).

import { addMonthsToMonth, clampedDate, diffDays, monthOf, splitMonth } from './dates.js';
import { money, percent, relativeDay, shortDate } from './format.js';
import {
    budgetStatus, cardSummary, expensesByCategory, forecastMonthEnd, goalProgress,
    isCredit, isWorkday, monthTotals, topExpenses, upcomingCommitments,
} from './finance.js';

/** Mesmo dia no mês anterior (limitado ao fim do mês): compara períodos equivalentes. */
function samePointLastMonth(today) {
    const prev = splitMonth(addMonthsToMonth(monthOf(today), -1));
    return clampedDate(prev.year, prev.month, Number(today.slice(8, 10)));
}

export function buildInsights({ accounts, categories, txs, recurrences, goals, goalDeposits, settings, today }) {
    const ym = monthOf(today);
    const prevYm = addMonthsToMonth(ym, -1);
    const prevPoint = samePointLastMonth(today);
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const out = [];

    // 1. Previsão de saldo no fim do mês.
    const f = forecastMonthEnd({ accounts, txs, recurrences, settings, today });
    if (f.daysLeft > 0) {
        out.push({
            id: 'forecast',
            weight: 90,
            tone: f.end < 0 ? 'warn' : 'info',
            icon: 'trending',
            text: `Mantendo seu ritmo atual, sua previsão de saldo para o dia ${Number(f.endDate.slice(8, 10))} é ${money(f.end)}.`,
        });
    }

    // 2. Compromissos dos próximos 7 dias.
    const next7 = upcomingCommitments({ accounts, txs, recurrences, today, days: 7 }).filter((i) => i.type === 'expense');
    if (next7.length) {
        const total = next7.reduce((acc, i) => acc + i.amount, 0);
        out.push({
            id: 'next7',
            weight: 80,
            tone: 'info',
            icon: 'calendar',
            text: `Existem ${money(total)} em despesas previstas para os próximos sete dias (${next7.length} ${next7.length === 1 ? 'conta' : 'contas'}).`,
        });
    }

    // 3. Orçamentos estourados ou quase.
    for (const b of budgetStatus(categories, txs, ym)) {
        if (b.level === 'over') {
            out.push({ id: `budget-${b.category.id}`, weight: 95, tone: 'danger', icon: 'alert', text: `Você passou ${money(b.spent - b.limit)} do orçamento de ${b.category.name} (${percent(b.ratio)} usado).` });
        } else if (b.level === 'warn') {
            out.push({ id: `budget-${b.category.id}`, weight: 85, tone: 'warn', icon: 'alert', text: `${b.category.name} já usou ${percent(b.ratio)} do orçamento. Restam ${money(b.remaining)} para o mês.` });
        }
    }

    // 4. Variação por categoria contra o mesmo período do mês passado.
    const now = expensesByCategory(txs, ym);
    const before = expensesByCategory(txs, prevYm, prevPoint);
    const changes = [];
    for (const [id, value] of now) {
        const prev = before.get(id) || 0;
        if (prev >= 50 && value >= 50) changes.push({ id, value, prev, ratio: value / prev - 1 });
    }
    changes.sort((a, b) => Math.abs(b.ratio) - Math.abs(a.ratio));
    for (const c of changes.slice(0, 2)) {
        if (c.ratio >= 0.15) {
            out.push({ id: `cat-up-${c.id}`, weight: 70, tone: 'warn', icon: 'up', text: `Seus gastos com ${catName.get(c.id) || 'Sem categoria'} aumentaram ${percent(c.ratio)} em relação ao mesmo período do mês passado.` });
        } else if (c.ratio <= -0.15) {
            out.push({ id: `cat-down-${c.id}`, weight: 60, tone: 'good', icon: 'down', text: `Boa! Você gastou ${percent(-c.ratio)} menos com ${catName.get(c.id) || 'Sem categoria'} do que no mesmo período do mês passado.` });
        }
    }

    // 5. Total do mês contra o mês anterior.
    const totalNow = monthTotals(txs, ym, today).expense;
    const totalPrev = monthTotals(txs, prevYm, prevPoint).expense;
    if (totalPrev > 0 && totalNow > 0) {
        const r = totalNow / totalPrev - 1;
        if (Math.abs(r) >= 0.1) {
            out.push({
                id: 'total',
                weight: 50,
                tone: r > 0 ? 'warn' : 'good',
                icon: r > 0 ? 'up' : 'down',
                text: `Até hoje você gastou ${money(totalNow)} — ${percent(Math.abs(r))} ${r > 0 ? 'a mais' : 'a menos'} que no mesmo ponto do mês passado.`,
            });
        }
    }

    // 6. Maior gasto do mês.
    const [biggest] = topExpenses(txs, ym, 1, today);
    if (biggest && totalNow > 0 && biggest.amount / totalNow >= 0.25) {
        out.push({ id: 'biggest', weight: 40, tone: 'info', icon: 'receipt', text: `"${biggest.description}" (${money(biggest.amount)}) representa ${percent(biggest.amount / totalNow)} dos seus gastos do mês.` });
    }

    // 7. Faturas vencendo.
    for (const card of accounts.filter(isCredit)) {
        const s = cardSummary(card, txs, today);
        const late = s.toPay.filter((inv) => inv.due < today);
        if (late.length === 1) {
            out.push({ id: `inv-late-${card.id}`, weight: 100, tone: 'danger', icon: 'card', text: `A fatura do ${card.name} (${money(late[0].remaining)}) venceu em ${shortDate(late[0].due)}.` });
        } else if (late.length > 1) {
            const total = late.reduce((acc, inv) => acc + inv.remaining, 0);
            out.push({ id: `inv-late-${card.id}`, weight: 100, tone: 'danger', icon: 'card', text: `${late.length} faturas do ${card.name} estão vencidas, somando ${money(total)}.` });
        }
        for (const inv of s.toPay) {
            const days = diffDays(today, inv.due);
            if (days >= 0 && days <= 5) {
                out.push({ id: `inv-${card.id}-${inv.ym}`, weight: 88, tone: 'warn', icon: 'card', text: `A fatura do ${card.name} de ${money(inv.remaining)} vence ${relativeDay(inv.due, today).toLowerCase()}.` });
            }
        }
        if (s.usage >= 0.9 && s.limit > 0) {
            out.push({ id: `limit-${card.id}`, weight: 75, tone: 'warn', icon: 'card', text: `Você está usando ${percent(s.usage)} do limite do ${card.name}.` });
        }
    }

    // 8. Metas.
    for (const goal of goals) {
        const p = goalProgress(goal, goalDeposits, today);
        if (p.done) continue;
        if (p.eta && p.saved > 0) {
            out.push({ id: `goal-${goal.id}`, weight: 30, tone: 'good', icon: 'target', text: `No ritmo atual (${money(p.monthlyAvg)}/mês), você atinge a meta "${goal.name}" em ${shortDate(p.eta)}.` });
        } else if (p.neededPerMonth) {
            out.push({ id: `goal-${goal.id}`, weight: 30, tone: 'info', icon: 'target', text: `Para a meta "${goal.name}" no prazo, guarde ${money(p.neededPerMonth)} por mês.` });
        }
    }

    // 9. Modo Diária: ritmo de dias trabalhados.
    if (settings?.mode === 'daily') {
        const worked = txs.filter((t) => isWorkday(t) && t.date.startsWith(ym)).length;
        const workedPrev = txs.filter((t) => isWorkday(t) && t.date.startsWith(prevYm) && t.date <= prevPoint).length;
        if (worked || workedPrev) {
            const diff = worked - workedPrev;
            out.push({
                id: 'workdays',
                weight: 55,
                tone: diff >= 0 ? 'good' : 'info',
                icon: 'briefcase',
                text: diff === 0
                    ? `Você trabalhou ${worked} ${worked === 1 ? 'dia' : 'dias'} neste mês — o mesmo ritmo do mês passado.`
                    : `Você trabalhou ${worked} ${worked === 1 ? 'dia' : 'dias'} neste mês, ${Math.abs(diff)} ${diff > 0 ? 'a mais' : 'a menos'} que no mesmo ponto do mês passado.`,
            });
        }
    }

    return out.sort((a, b) => b.weight - a.weight);
}
