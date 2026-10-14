// Escritas das contas a pagar. As regras (status, totais, validação) ficam em
// finance.js; aqui só o que mexe no banco, mantendo cada pagamento e o seu
// lançamento ligado (billpay:<id>) sempre juntos.

import { todayISO } from './dates.js';
import { db } from './db.js';
import { SEED_UPDATED_AT } from './defaults.js';
import { billPaymentTxId, billsLedger, buildBillPaymentTx, dueRecurringBills } from './finance.js';
import { round2 } from './format.js';
import { newId, removeMany, save, saveMany } from './store.js';

const alive = (rows) => rows.filter((r) => !r.deleted);

/**
 * Gera a próxima competência das contas mensais já pagas. O updatedAt antigo
 * faz qualquer edição real (em qualquer aparelho) vencer a geração automática.
 */
export async function materializeBills(today = todayISO()) {
    const all = await db.bills.toArray();
    if (!all.length) return 0;
    const ledger = billsLedger({ bills: alive(all), payments: alive(await db.billPayments.toArray()) }, today);
    const due = dueRecurringBills(ledger, new Set(all.map((b) => b.id)));
    if (due.length) await saveMany('bills', due, { updatedAt: SEED_UPDATED_AT });
    return due.length;
}

/** Salva a conta e mantém a descrição dos lançamentos dos pagamentos igual à dela. */
export async function saveBill(bill) {
    const saved = await save('bills', { ...bill, amount: round2(bill.amount) });
    const payments = alive(await db.billPayments.where('billId').equals(saved.id).toArray());
    const txs = alive(await db.transactions.bulkGet(payments.map((p) => billPaymentTxId(p.id))).then((r) => r.filter(Boolean)));
    const stale = txs.filter((t) => t.description !== saved.description);
    if (stale.length) await saveMany('transactions', stale.map((t) => ({ ...t, description: saved.description })));
    return saved;
}

/** Registra ou altera um pagamento, criando/atualizando/removendo o lançamento ligado. */
export async function saveBillPayment(payment, bill) {
    const record = { ...payment, id: payment.id || newId('bp-'), billId: bill.id, amount: round2(payment.amount), fromReserve: round2(payment.fromReserve || 0) };
    const saved = await save('billPayments', record);
    const tx = buildBillPaymentTx(saved, bill);
    if (tx) await save('transactions', tx);
    else await removeMany('transactions', [billPaymentTxId(saved.id)]);
    await materializeBills();
    return saved;
}

/** Cópia dos registros para o "Desfazer" depois de uma exclusão. */
async function snapshot(collection, ids) {
    return (await db.table(collection).bulkGet(ids)).filter((r) => r && !r.deleted);
}

export async function deleteBillPayment(paymentId) {
    const txId = billPaymentTxId(paymentId);
    const before = { billPayments: await snapshot('billPayments', [paymentId]), transactions: await snapshot('transactions', [txId]) };
    await removeMany('billPayments', [paymentId]);
    await removeMany('transactions', [txId]);
    return () => restore(before);
}

/** Exclui a conta com os pagamentos e os lançamentos deles. Devolve o "desfazer". */
export async function deleteBill(billId) {
    const payments = alive(await db.billPayments.where('billId').equals(billId).toArray());
    const txIds = payments.map((p) => billPaymentTxId(p.id));
    const before = {
        bills: await snapshot('bills', [billId]),
        billPayments: payments,
        transactions: await snapshot('transactions', txIds),
    };
    await removeMany('transactions', txIds);
    await removeMany('billPayments', payments.map((p) => p.id));
    await removeMany('bills', [billId]);
    return () => restore(before);
}

async function restore(before) {
    for (const [collection, rows] of Object.entries(before)) await saveMany(collection, rows);
}
