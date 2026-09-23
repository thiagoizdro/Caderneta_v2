// Núcleo de cálculos do Caderneta. Funções puras: recebem os registros e
// devolvem números — nada aqui acessa banco, rede ou DOM, então tudo é
// testável em Node (ver client/test).

import {
    addDays, addMonths, addMonthsToMonth, clampedDate, daysInMonth, diffDays,
    endOfMonth, monthOf, splitMonth, startOfMonth,
} from './dates.js';
import { round2 } from './format.js';

// ------------------------------------------------------------
// Básico
// ------------------------------------------------------------

const inMonth = (t, ym) => t.date.startsWith(ym);

export const isCredit = (account) => account?.type === 'credit';

/**
 * Conta sugerida para um novo lançamento: a última usada nesse tipo de
 * lançamento; senão a conta preferida do perfil; senão a primeira que não é cartão.
 */
export function defaultAccountId({ accounts, transactions = [], profile, type = 'expense', preferredId }) {
    const active = accounts.filter((a) => !a.archived && (type !== 'income' || !isCredit(a)));
    const ok = (id) => id && active.some((a) => a.id === id);
    if (ok(preferredId)) return preferredId;
    const recent = transactions.find((t) => t.type === type && t.source !== 'workday' && ok(t.accountId));
    if (recent) return recent.accountId;
    if (ok(profile?.workAccountId)) return profile.workAccountId;
    return (active.find((a) => !isCredit(a)) || active[0])?.id || '';
}

export function sum(list, fn = (x) => x) {
    return round2(list.reduce((acc, x) => acc + (Number(fn(x)) || 0), 0));
}

/** Efeito de um lançamento no saldo de uma conta. */
export function accountDelta(tx, accountId) {
    const amount = Number(tx.amount) || 0;
    switch (tx.type) {
        case 'income': return tx.accountId === accountId ? amount : 0;
        case 'expense': return tx.accountId === accountId ? -amount : 0;
        case 'transfer':
            return (tx.toAccountId === accountId ? amount : 0) - (tx.accountId === accountId ? amount : 0);
        default: return 0;
    }
}

/** Saldo de cada conta. `asOf` = só lançamentos até essa data (null = todos, inclusive futuros). */
export function accountBalances(accounts, txs, asOf = null) {
    const balances = new Map(accounts.map((a) => [a.id, Number(a.initialBalance) || 0]));
    for (const tx of txs) {
        if (asOf && tx.date > asOf) continue;
        for (const id of new Set([tx.accountId, tx.toAccountId])) {
            if (id && balances.has(id)) balances.set(id, balances.get(id) + accountDelta(tx, id));
        }
    }
    for (const [id, v] of balances) balances.set(id, round2(v));
    return balances;
}

/** Dinheiro disponível: soma das contas que não são cartão de crédito. */
export function cashBalance(accounts, txs, asOf) {
    const balances = accountBalances(accounts, txs, asOf);
    return sum(accounts.filter((a) => !isCredit(a)), (a) => balances.get(a.id));
}

/** Receitas e despesas do mês (transferências não contam). `upTo` limita até um dia. */
export function monthTotals(txs, ym, upTo = null) {
    let income = 0;
    let expense = 0;
    for (const t of txs) {
        if (!inMonth(t, ym) || (upTo && t.date > upTo)) continue;
        if (t.type === 'income') income += Number(t.amount) || 0;
        else if (t.type === 'expense') expense += Number(t.amount) || 0;
    }
    return { income: round2(income), expense: round2(expense), net: round2(income - expense) };
}

export function expensesByCategory(txs, ym, upTo = null) {
    const totals = new Map();
    for (const t of txs) {
        if (t.type !== 'expense' || !inMonth(t, ym) || (upTo && t.date > upTo)) continue;
        const key = t.categoryId || 'sem-categoria';
        totals.set(key, round2((totals.get(key) || 0) + Number(t.amount)));
    }
    return totals;
}

export function monthlySeries(txs, months) {
    return months.map((month) => ({ month, ...monthTotals(txs, month) }));
}

/** Saldo em contas no fim de cada mês (ou hoje, no mês corrente). */
export function balanceSeries(accounts, txs, months, today) {
    return months
        .filter((m) => startOfMonth(m) <= today)
        .map((month) => {
            const end = endOfMonth(month);
            return { month, balance: cashBalance(accounts, txs, end < today ? end : today) };
        });
}

export function topExpenses(txs, ym, limit = 5, upTo = null) {
    return txs
        .filter((t) => t.type === 'expense' && inMonth(t, ym) && (!upTo || t.date <= upTo))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, limit);
}

// ------------------------------------------------------------
// Modo Diária e Salário Mensal
// ------------------------------------------------------------

export const workdayId = (date) => `workday:${date}`;

export const isWorkday = (t) => t.source === 'workday';

/** O "recibo" do modo Diária: bruto dos dias trabalhados, gastos pessoais e repasses a terceiros. */
export function dailyReceipt(txs, ym) {
    const month = txs.filter((t) => inMonth(t, ym));
    const workdays = month.filter(isWorkday);
    const gross = sum(workdays, (t) => t.amount);
    const otherIncome = sum(month.filter((t) => t.type === 'income' && !isWorkday(t)), (t) => t.amount);
    const personal = sum(month.filter((t) => t.type === 'expense' && !t.person), (t) => t.amount);
    const thirdParty = sum(month.filter((t) => t.type === 'expense' && t.person), (t) => t.amount);
    const net = round2(gross + otherIncome - personal);
    return { days: workdays.length, gross, otherIncome, personal, thirdParty, net, real: round2(net - thirdParty) };
}

/** O resumo do modo Salário Mensal. */
export function monthlyReceipt(txs, ym, salaryCategoryId) {
    const month = txs.filter((t) => inMonth(t, ym));
    const salary = sum(month.filter((t) => t.type === 'income' && t.categoryId === salaryCategoryId), (t) => t.amount);
    const otherIncome = sum(month.filter((t) => t.type === 'income' && t.categoryId !== salaryCategoryId), (t) => t.amount);
    const expenses = sum(month.filter((t) => t.type === 'expense'), (t) => t.amount);
    const thirdParty = sum(month.filter((t) => t.type === 'expense' && t.person), (t) => t.amount);
    return { salary, otherIncome, expenses, thirdParty, available: round2(salary + otherIncome - expenses) };
}

// ------------------------------------------------------------
// Cartão de crédito
// ------------------------------------------------------------

/**
 * Datas de uma fatura identificada pelo mês de fechamento.
 * Compras feitas até o dia de fechamento entram na fatura daquele mês;
 * depois disso, na do mês seguinte. Vencimento antes do fechamento = mês seguinte.
 */
export function invoicePeriod(ym, closingDay, dueDay) {
    const { year, month } = splitMonth(ym);
    const prev = splitMonth(addMonthsToMonth(ym, -1));
    const closing = clampedDate(year, month, closingDay);
    const start = addDays(clampedDate(prev.year, prev.month, closingDay), 1);
    const dueMonth = dueDay > closingDay ? { year, month } : splitMonth(addMonthsToMonth(ym, 1));
    const due = clampedDate(dueMonth.year, dueMonth.month, dueDay);
    return { ym, start, closing, due };
}

export function invoiceMonthFor(date, closingDay) {
    const ym = monthOf(date);
    const { year, month } = splitMonth(ym);
    return date <= clampedDate(year, month, closingDay) ? ym : addMonthsToMonth(ym, 1);
}

/**
 * Resumo de um cartão: limite, faturas (com pagamentos distribuídos da mais
 * antiga para a mais nova), fatura atual, fatura fechada a pagar e próximas.
 */
export function cardSummary(card, txs, today) {
    const closingDay = Number(card.closingDay) || 1;
    const dueDay = Number(card.dueDay) || 10;
    const limit = Number(card.creditLimit) || 0;

    const invoices = new Map();
    const getInvoice = (ym) => {
        if (!invoices.has(ym)) invoices.set(ym, { ...invoicePeriod(ym, closingDay, dueDay), amount: 0, paid: 0, items: [] });
        return invoices.get(ym);
    };

    let payments = 0;
    let committed = -(Number(card.initialBalance) || 0);
    for (const t of txs) {
        const delta = accountDelta(t, card.id);
        if (!delta) continue;
        committed -= delta;
        const isPayment = t.type === 'transfer' && t.toAccountId === card.id;
        if (isPayment) {
            if (t.date <= today) payments += Number(t.amount);
            continue;
        }
        const inv = getInvoice(invoiceMonthFor(t.date, closingDay));
        inv.amount = round2(inv.amount - delta);
        inv.items.push(t);
    }

    const ordered = [...invoices.values()].sort((a, b) => (a.ym < b.ym ? -1 : 1));
    let pool = payments;
    for (const inv of ordered) {
        inv.paid = round2(Math.min(Math.max(inv.amount, 0), pool));
        pool = round2(pool - inv.paid);
        inv.remaining = round2(Math.max(inv.amount - inv.paid, 0));
        inv.status = inv.closing >= today ? 'open' : inv.remaining <= 0 ? 'paid' : inv.due < today ? 'overdue' : 'closed';
    }

    const currentYm = invoiceMonthFor(today, closingDay);
    const current = invoices.get(currentYm) || { ...invoicePeriod(currentYm, closingDay, dueDay), amount: 0, paid: 0, remaining: 0, items: [], status: 'open' };
    const toPay = ordered.filter((inv) => inv.ym < currentYm && inv.remaining > 0);
    const upcoming = ordered.filter((inv) => inv.ym > currentYm);

    committed = round2(committed);
    return {
        limit,
        committed,
        available: round2(limit - Math.max(committed, 0)),
        usage: limit > 0 ? Math.max(committed, 0) / limit : 0,
        current,
        toPay,
        upcoming,
        invoices: ordered,
    };
}

// ------------------------------------------------------------
// Recorrências
// ------------------------------------------------------------

export const FREQUENCIES = { monthly: 'Mensal', weekly: 'Semanal', yearly: 'Anual' };

export const occurrenceId = (recurrenceId, date) => `${recurrenceId}:${date}`;

/**
 * Datas em que uma recorrência acontece dentro de [from, to].
 * `activeFrom` é gravado quando o agendamento muda (outro dia, outra frequência):
 * as datas antigas já geradas não ganham "gêmeas" no novo dia.
 */
export function recurrenceDates(rec, from, to) {
    const start = rec.startDate;
    const end = rec.endDate && rec.endDate < to ? rec.endDate : to;
    let lower = from > start ? from : start;
    if (rec.activeFrom && rec.activeFrom > lower) lower = rec.activeFrom;
    if (lower > end || rec.paused) return [];

    const dates = [];
    if (rec.frequency === 'weekly') {
        const offset = Math.max(0, Math.ceil(diffDays(start, lower) / 7));
        for (let d = addDays(start, offset * 7); d <= end; d = addDays(d, 7)) dates.push(d);
    } else if (rec.frequency === 'yearly') {
        const day = Number(start.slice(8, 10));
        const month = Number(start.slice(5, 7));
        for (let y = Number(lower.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
            const d = clampedDate(y, month, day);
            if (d >= lower && d <= end) dates.push(d);
        }
    } else {
        const day = Number(rec.day) || Number(start.slice(8, 10));
        for (let ym = monthOf(lower); ym <= monthOf(end); ym = addMonthsToMonth(ym, 1)) {
            const { year, month } = splitMonth(ym);
            const d = clampedDate(year, month, day);
            if (d >= lower && d <= end) dates.push(d);
        }
    }
    return dates;
}

/** Recorrência com agendamento novo, valendo só depois da última ocorrência já gerada. */
export function withScheduleChange(prev, next, lastGeneratedDate) {
    const changed = prev && (prev.frequency !== next.frequency || Number(prev.day) !== Number(next.day) || prev.startDate !== next.startDate);
    if (!changed || !lastGeneratedDate) return next;
    return { ...next, activeFrom: addDays(lastGeneratedDate, 1) };
}

export function nextOccurrence(rec, today) {
    return recurrenceDates(rec, today, addMonths(today, 13))[0] || null;
}

export function buildRecurrenceTx(rec, date) {
    return {
        id: occurrenceId(rec.id, date),
        type: rec.type,
        amount: rec.amount,
        description: rec.description,
        date,
        categoryId: rec.categoryId || null,
        accountId: rec.accountId || null,
        toAccountId: rec.toAccountId || null,
        person: rec.person || '',
        source: 'recurrence',
        recurrenceId: rec.id,
    };
}

/**
 * Lançamentos de recorrências que já venceram e ainda não existem.
 * `knownIds` deve incluir registros excluídos: se o usuário apagou uma
 * ocorrência, ela não volta. Ids determinísticos evitam duplicatas entre aparelhos.
 */
export function dueRecurrenceTxs(recurrences, knownIds, today, lookbackMonths = 12) {
    const from = addMonths(today, -lookbackMonths, 1);
    const out = [];
    for (const rec of recurrences) {
        for (const date of recurrenceDates(rec, from, today)) {
            const id = occurrenceId(rec.id, date);
            if (!knownIds.has(id)) out.push(buildRecurrenceTx(rec, date));
        }
    }
    return out;
}

/** Ocorrências futuras (ainda não lançadas) entre `from` e `to`. */
export function pendingOccurrences(recurrences, knownIds, from, to) {
    const out = [];
    for (const rec of recurrences) {
        for (const date of recurrenceDates(rec, from, to)) {
            if (!knownIds.has(occurrenceId(rec.id, date))) out.push({ rec, date, tx: buildRecurrenceTx(rec, date) });
        }
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ------------------------------------------------------------
// Parcelamentos
// ------------------------------------------------------------

/** Divide em parcelas sem perder centavos (a diferença vai para a primeira). */
export function splitInstallments(total, count) {
    const cents = Math.round(total * 100);
    const base = Math.floor(cents / count);
    const rest = cents - base * count;
    return Array.from({ length: count }, (_, i) => (base + (i === 0 ? rest : 0)) / 100);
}

export function buildInstallments({ groupId, description, totalAmount, count, firstDate, ...fields }) {
    const amounts = splitInstallments(totalAmount, count);
    const day = Number(firstDate.slice(8, 10));
    return amounts.map((amount, i) => ({
        ...fields,
        id: `${groupId}:${i + 1}`,
        type: 'expense',
        amount,
        description,
        date: addMonths(firstDate, i, day),
        source: 'installment',
        installment: { groupId, index: i + 1, total: count, totalAmount },
    }));
}

export function installmentGroups(txs, today) {
    const groups = new Map();
    for (const t of txs) {
        if (!t.installment) continue;
        const g = groups.get(t.installment.groupId) || { groupId: t.installment.groupId, items: [] };
        g.items.push(t);
        groups.set(t.installment.groupId, g);
    }
    return [...groups.values()].map((g) => {
        const items = g.items.sort((a, b) => a.installment.index - b.installment.index);
        const first = items[0];
        const paid = items.filter((t) => t.date <= today);
        const next = items.find((t) => t.date > today);
        return {
            groupId: g.groupId,
            description: first.description,
            accountId: first.accountId,
            categoryId: first.categoryId,
            totalAmount: first.installment.totalAmount ?? sum(items, (t) => t.amount),
            count: first.installment.total,
            installmentAmount: items[items.length - 1].amount,
            paidCount: paid.length,
            paidAmount: sum(paid, (t) => t.amount),
            remainingAmount: sum(items.filter((t) => t.date > today), (t) => t.amount),
            nextDate: next?.date || null,
            done: !next,
            items,
        };
    }).sort((a, b) => Number(a.done) - Number(b.done) || (a.nextDate || '').localeCompare(b.nextDate || ''));
}

// ------------------------------------------------------------
// Orçamento
// ------------------------------------------------------------

export function budgetLevel(ratio) {
    if (ratio >= 1) return 'over';
    if (ratio >= 0.8) return 'warn';
    return 'ok';
}

export function budgetStatus(categories, txs, ym) {
    const spent = expensesByCategory(txs, ym);
    return categories
        .filter((c) => c.kind === 'expense' && Number(c.budget) > 0)
        .map((category) => {
            const used = spent.get(category.id) || 0;
            const limit = Number(category.budget);
            const ratio = used / limit;
            return { category, spent: used, limit, ratio, remaining: round2(limit - used), level: budgetLevel(ratio) };
        })
        .sort((a, b) => b.ratio - a.ratio);
}

// ------------------------------------------------------------
// Previsões
// ------------------------------------------------------------

const isVariable = (t) => t.type === 'expense' && !['recurrence', 'installment'].includes(t.source);

/**
 * Previsão do saldo em contas no fim do mês:
 *   saldo de hoje
 *   + lançamentos já agendados no resto do mês (futuros, fora de cartão)
 *   + recorrências que ainda vão acontecer
 *   − faturas de cartão que vencem até o fim do mês
 *   − gasto variável projetado (média diária do mês × dias restantes)
 *   + diárias projetadas (no modo Diária, pelo ritmo de dias trabalhados)
 */
export function forecastMonthEnd({ accounts, txs, recurrences, settings = {}, today }) {
    const ym = monthOf(today);
    const end = endOfMonth(ym);
    const daysLeft = diffDays(today, end);
    const cashIds = new Set(accounts.filter((a) => !isCredit(a)).map((a) => a.id));
    const cashDelta = (t) => [...cashIds].reduce((acc, id) => acc + accountDelta(t, id), 0);

    const current = cashBalance(accounts, txs, today);

    const scheduled = sum(txs.filter((t) => t.date > today && t.date <= end), cashDelta);

    const knownIds = new Set(txs.map((t) => t.id));
    const tomorrow = addDays(today, 1);
    const pending = pendingOccurrences(recurrences, knownIds, tomorrow, end);
    const recurring = sum(pending, (p) => cashDelta({ ...p.tx, amount: Number(p.tx.amount) }));

    let cardDue = 0;
    for (const card of accounts.filter(isCredit)) {
        const summary = cardSummary(card, txs, today);
        for (const inv of [...summary.toPay, summary.current, ...summary.upcoming]) {
            if (inv.due >= today && inv.due <= end) cardDue += inv.remaining ?? Math.max(inv.amount - inv.paid, 0);
        }
    }
    cardDue = round2(cardDue);

    // Ritmo de gasto variável em contas (cartão entra via fatura).
    const dayOfMonth = Number(today.slice(8, 10));
    let dailyVariable;
    if (dayOfMonth >= 7) {
        dailyVariable = sum(txs.filter((t) => isVariable(t) && cashIds.has(t.accountId) && inMonth(t, ym) && t.date <= today), (t) => t.amount) / dayOfMonth;
    } else {
        const prev = addMonthsToMonth(ym, -1);
        const { year, month } = splitMonth(prev);
        dailyVariable = sum(txs.filter((t) => isVariable(t) && cashIds.has(t.accountId) && inMonth(t, prev)), (t) => t.amount) / daysInMonth(year, month);
    }
    const variable = round2(dailyVariable * daysLeft);

    let work = 0;
    if (settings.mode === 'daily' && Number(settings.dailyRate) > 0) {
        const worked = txs.filter((t) => isWorkday(t) && inMonth(t, ym) && t.date <= today).length;
        work = round2((worked / dayOfMonth) * daysLeft * Number(settings.dailyRate));
    }

    const endBalance = round2(current + scheduled + recurring - cardDue - variable + work);
    return { current, scheduled, recurring, cardDue, variable, work, end: endBalance, endDate: end, daysLeft, pendingCount: pending.length };
}

/** Compromissos dos próximos dias: recorrências, lançamentos agendados e faturas. */
export function upcomingCommitments({ accounts, txs, recurrences, today, days = 7 }) {
    const to = addDays(today, days);
    const from = addDays(today, 1);
    const knownIds = new Set(txs.map((t) => t.id));
    const items = [];

    for (const p of pendingOccurrences(recurrences, knownIds, from, to)) {
        items.push({ key: p.tx.id, date: p.date, description: p.rec.description, amount: Number(p.rec.amount), type: p.rec.type, kind: 'recurrence' });
    }
    for (const t of txs) {
        if (t.date >= from && t.date <= to && t.type !== 'transfer') {
            items.push({ key: t.id, date: t.date, description: t.description, amount: Number(t.amount), type: t.type, kind: t.source === 'installment' ? 'installment' : 'scheduled', tx: t });
        }
    }
    for (const card of accounts.filter(isCredit)) {
        const s = cardSummary(card, txs, today);
        for (const inv of [...s.toPay, s.current]) {
            if (inv.due >= today && inv.due <= to && inv.remaining > 0) {
                items.push({ key: `inv:${card.id}:${inv.ym}`, date: inv.due, description: `Fatura ${card.name}`, amount: inv.remaining, type: 'expense', kind: 'invoice', accountId: card.id });
            }
        }
    }
    return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ------------------------------------------------------------
// Metas
// ------------------------------------------------------------

export function goalProgress(goal, deposits, today) {
    const own = deposits.filter((d) => d.goalId === goal.id).sort((a, b) => (a.date < b.date ? -1 : 1));
    const saved = sum(own, (d) => d.amount);
    const target = Number(goal.target) || 0;
    const remaining = round2(Math.max(target - saved, 0));
    const ratio = target > 0 ? Math.min(saved / target, 1) : 0;

    let monthlyAvg = 0;
    let eta = null;
    if (own.length) {
        const months = Math.max(1, diffDays(own[0].date, today) / 30.44);
        monthlyAvg = round2(saved / Math.max(months, 1));
        if (remaining > 0 && monthlyAvg > 0) {
            eta = addMonths(today, Math.ceil(remaining / monthlyAvg));
        }
    }

    let neededPerMonth = null;
    if (goal.deadline && remaining > 0) {
        const monthsLeft = Math.max(1, Math.ceil(diffDays(today, goal.deadline) / 30.44));
        neededPerMonth = round2(remaining / monthsLeft);
    }

    return { saved, target, remaining, ratio, monthlyAvg, eta, neededPerMonth, done: target > 0 && saved >= target, deposits: own };
}
