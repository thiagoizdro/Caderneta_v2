// Escritas do planejamento de contas. Cada item é só descrição, valor e
// vencimento: salvar ou excluir nunca cria lançamento nem muda saldo.

import { db } from './db.js';
import { round2 } from './format.js';
import { removeMany, save, saveMany } from './store.js';

export function saveBill(bill) {
    return save('bills', {
        ...bill,
        description: bill.description.trim(),
        amount: round2(bill.amount),
        dueDate: bill.dueDate,
    });
}

/** Exclui um item do planejamento. Devolve o "desfazer". */
export async function deleteBill(billId) {
    const before = (await db.bills.bulkGet([billId])).filter((r) => r && !r.deleted);
    await removeMany('bills', [billId]);
    return () => saveMany('bills', before);
}
