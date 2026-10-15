// Migração 3.0: separa as diárias das movimentações e simplifica as contas a
// pagar. Funções puras (testadas em Node): recebem TODOS os registros, inclusive
// os excluídos, e devolvem o que gravar. A gravação fica em bootstrap.js.
//
// Regras:
//   1. Diária "a receber" (transação na conta virtual `a-receber`): nunca mexeu
//      no saldo. Vira um registro em `workdays` e a transação é excluída (a
//      lápide guarda os dados, então dá para desfazer).
//   2. Diária antiga lançada direto numa conta: JÁ somou no saldo. Continua
//      como receita (o saldo não muda), vira `legacy-workday` com
//      `workdayAmount` = valor, e o dia também vai para `workdays`. Fica no
//      relatório para revisão manual.
//   3. Pagamento de diárias (transferência a-receber → conta): é dinheiro que
//      entrou de verdade. Vira uma receita na conta de destino com
//      `workdayAmount` = valor. O saldo da conta não muda (antes +valor pela
//      transferência, agora +valor pela receita).
//   4. Lançamentos de pagamentos de contas (`billpay:`) são despesas reais e
//      ficam como estão.
//   5. Contas a pagar já quitadas saem do planejamento (`archived`); as pagas
//      em parte ficam com o valor que faltava. Pagamentos e reserva antigos
//      não são apagados, só deixam de ser usados.
//
// Cada registro alterado guarda `migration: { id, original }`. Isso torna a
// migração idempotente (o que já tem a marca é pulado) e reversível.

import { cashBalance, accountBalances } from './finance.js';
import { CATEGORY_IDS, RECEIVABLE_ID } from './defaults.js';
import { round2 } from './format.js';

export const MIGRATION_ID = 'v3-diarias-planejamento';

const alive = (r) => r && !r.deleted;
const marked = (r) => r?.migration?.id === MIGRATION_ID;
const cents = (v) => Math.round((Number(v) || 0) * 100);

// Possíveis lançamentos manuais feitos para compensar diárias.
const WORK_WORDS = /di[aá]ri|empresa|pagamento|acerto|quinzena|servi[cç]o/i;

/**
 * Planeja a migração. `stamp(record)` devolve o updatedAt a usar: o anterior + 1
 * (determinístico entre aparelhos e perde para qualquer edição real feita depois).
 */
export function planMigration({ transactions = [], workdays = [], bills = [], billPayments = [], accounts = [] }) {
    const accountIds = new Set(accounts.filter(alive).map((a) => a.id));
    // Dias que já existem. Uma lápide deixada pelo "desfazer" não conta: o dia
    // volta. Já um dia desmarcado pelo usuário continua desmarcado.
    const existingDays = new Map(workdays.map((w) => [w.id, w]));
    const blocksDay = (w) => w && !(w.deleted && w.migration?.reverted);
    const txs = transactions.filter(alive);

    const newWorkdays = [];
    const txUpdates = [];
    const txDeletes = [];
    const billUpdates = [];
    const review = [];

    const addWorkday = (t, from) => {
        const existing = existingDays.get(t.id);
        if (blocksDay(existing)) return;
        const row = {
            id: t.id, date: t.date, amount: round2(t.amount), notes: t.notes || '',
            createdAt: t.createdAt, updatedAt: Math.max(t.updatedAt || 0, existing?.updatedAt || 0) + 1,
            migration: { id: MIGRATION_ID, from },
        };
        existingDays.set(t.id, row);
        newWorkdays.push(row);
    };

    for (const t of txs) {
        if (marked(t)) continue;

        if (t.source === 'workday') {
            const direct = t.type === 'income' && accountIds.has(t.accountId);
            if (direct) {
                addWorkday(t, 'legacy-workday');
                txUpdates.push({
                    ...t,
                    source: 'legacy-workday',
                    workdayAmount: round2(t.amount),
                    updatedAt: (t.updatedAt || 0) + 1,
                    migration: { id: MIGRATION_ID, original: { source: t.source, workdayAmount: t.workdayAmount ?? null } },
                });
                review.push({ kind: 'legacy-workday', id: t.id, date: t.date, amount: round2(t.amount), accountId: t.accountId,
                    note: 'Diária antiga lançada direto na conta: já estava somada no saldo e continua como receita. Confira se o pagamento real dela não foi lançado de novo.' });
            } else {
                addWorkday(t, 'receivable');
                txDeletes.push({ ...t, updatedAt: (t.updatedAt || 0) + 1, migration: { id: MIGRATION_ID, deleted: true } });
            }
            continue;
        }

        if (t.source === 'workpayment') {
            if (t.type === 'transfer' && t.accountId === RECEIVABLE_ID) {
                txUpdates.push({
                    ...t,
                    type: 'income',
                    accountId: t.toAccountId,
                    toAccountId: null,
                    categoryId: CATEGORY_IDS.work,
                    workdayAmount: round2(t.amount),
                    updatedAt: (t.updatedAt || 0) + 1,
                    migration: {
                        id: MIGRATION_ID,
                        original: { type: t.type, accountId: t.accountId, toAccountId: t.toAccountId, categoryId: t.categoryId ?? null, workdayAmount: t.workdayAmount ?? null },
                    },
                });
            } else {
                review.push({ kind: 'odd-workpayment', id: t.id, date: t.date, amount: round2(t.amount),
                    note: 'Pagamento de diárias em formato inesperado: não foi alterado.' });
            }
        }
    }

    // Contas a pagar → planejamento.
    const paidByBill = new Map();
    for (const p of billPayments.filter(alive)) paidByBill.set(p.billId, (paidByBill.get(p.billId) || 0) + cents(p.amount));
    for (const b of bills.filter(alive)) {
        if (marked(b) || b.archived) continue;
        const paid = paidByBill.get(b.id) || 0;
        if (!paid) continue;
        const amount = cents(b.amount);
        const original = { amount: b.amount, archived: b.archived ?? null };
        if (paid >= amount) {
            billUpdates.push({ ...b, archived: true, updatedAt: (b.updatedAt || 0) + 1, migration: { id: MIGRATION_ID, original } });
            review.push({ kind: 'bill-paid', id: b.id, date: b.dueDate, amount: amount / 100, description: b.description,
                note: 'Conta já quitada: saiu do planejamento (não foi apagada).' });
        } else {
            billUpdates.push({ ...b, amount: (amount - paid) / 100, updatedAt: (b.updatedAt || 0) + 1, migration: { id: MIGRATION_ID, original } });
            review.push({ kind: 'bill-partial', id: b.id, date: b.dueDate, amount: (amount - paid) / 100, description: b.description,
                note: `Conta paga em parte: o planejamento ficou com o que faltava (${(amount - paid) / 100} de ${amount / 100}).` });
        }
    }

    // Receitas manuais que podem ter sido lançadas para compensar diárias.
    const converted = txUpdates.filter((t) => t.source === 'workpayment');
    const legacyMonths = new Set(txUpdates.filter((t) => t.source === 'legacy-workday').map((t) => t.date.slice(0, 7)));
    for (const t of txs) {
        if (t.type !== 'income' || ['workday', 'workpayment', 'legacy-workday', 'recurrence'].includes(t.source) || marked(t)) continue;
        const sameAsPayment = converted.some((p) => p.date === t.date && cents(p.amount) === cents(t.amount));
        const looksLikeWork = t.categoryId === CATEGORY_IDS.work || WORK_WORDS.test(t.description || '');
        if (sameAsPayment || (looksLikeWork && (converted.length || legacyMonths.has(t.date.slice(0, 7))))) {
            review.push({ kind: 'possible-duplicate', id: t.id, date: t.date, amount: round2(t.amount), description: t.description,
                note: sameAsPayment
                    ? 'Receita manual no mesmo dia e valor de um pagamento de diárias: pode estar contada duas vezes.'
                    : 'Receita manual que parece ser de diárias: confira se não duplica um pagamento já registrado.' });
        }
    }

    // Validação: o saldo de cada conta tem de ser o mesmo antes e depois.
    const updates = new Map(txUpdates.map((t) => [t.id, t]));
    const deleted = new Set(txDeletes.map((t) => t.id));
    const after = txs.filter((t) => !deleted.has(t.id)).map((t) => updates.get(t.id) || t);
    const liveAccounts = accounts.filter(alive);
    const balBefore = accountBalances(liveAccounts, txs);
    const balAfter = accountBalances(liveAccounts, after);
    const mismatches = liveAccounts
        .filter((a) => cents(balBefore.get(a.id)) !== cents(balAfter.get(a.id)))
        .map((a) => ({ accountId: a.id, name: a.name, before: balBefore.get(a.id), after: balAfter.get(a.id) }));

    const changes = newWorkdays.length + txUpdates.length + txDeletes.length + billUpdates.length;
    return {
        changes,
        newWorkdays,
        txUpdates,
        txDeletes,
        billUpdates,
        review,
        balance: { before: cashBalance(liveAccounts, txs), after: cashBalance(liveAccounts, after), mismatches, ok: mismatches.length === 0 },
        counts: {
            workdaysCreated: newWorkdays.length,
            receivableWorkdaysRemoved: txDeletes.length,
            legacyWorkdays: txUpdates.filter((t) => t.source === 'legacy-workday').length,
            paymentsConverted: converted.length,
            billPaymentTxsKept: txs.filter((t) => t.source === 'billpayment').length,
            billsArchived: billUpdates.filter((b) => b.archived).length,
            billsReduced: billUpdates.filter((b) => !b.archived).length,
            reviewCount: review.length,
        },
    };
}

/**
 * Desfaz a migração: restaura os campos originais das transações e contas,
 * revive as transações excluídas e exclui os dias criados por ela.
 */
export function planRevert({ transactions = [], workdays = [], bills = [] }) {
    const restore = (r) => {
        const { migration, ...rest } = r;
        const out = { ...rest };
        for (const [k, v] of Object.entries(migration.original || {})) {
            if (v === null) delete out[k];
            else out[k] = v;
        }
        return { ...out, updatedAt: Date.now() };
    };
    return {
        txRestores: transactions.filter((t) => marked(t) && !t.deleted && t.migration.original).map(restore),
        txRevives: transactions.filter((t) => marked(t) && t.deleted && t.migration.deleted).map(({ migration, ...t }) => ({ ...t, deleted: 0, updatedAt: Date.now() })),
        billRestores: bills.filter((b) => marked(b) && !b.deleted && b.migration.original).map(restore),
        // Marcados como "reverted" para que uma nova aplicação recrie esses dias.
        workdayDeletes: workdays.filter((w) => marked(w) && !w.deleted)
            .map((w) => ({ ...w, deleted: 1, updatedAt: Date.now(), migration: { ...w.migration, reverted: true } })),
    };
}
