import Dexie from 'dexie';

// Coleções sincronizadas com o servidor (mesma lista de server/src/sync.js).
export const COLLECTIONS = ['settings', 'accounts', 'categories', 'transactions', 'recurrences', 'goals', 'goalDeposits'];

// Campos de controle guardados junto de cada registro, mas que não são "dados":
//   updatedAt — relógio da última alteração (resolve conflitos)
//   deleted   — 1 = excluído (lápide, para a exclusão também sincronizar)
//   _pending  — 1 = alteração local ainda não enviada ao servidor
export const META_FIELDS = ['id', 'updatedAt', 'deleted', '_pending'];

export const db = new Dexie('caderneta');

db.version(1).stores({
    settings: 'id, _pending',
    accounts: 'id, _pending',
    categories: 'id, _pending',
    transactions: 'id, date, _pending, recurrenceId',
    recurrences: 'id, _pending',
    goals: 'id, _pending',
    goalDeposits: 'id, goalId, _pending',
    meta: 'key',
});

export async function getMeta(key, fallback = null) {
    const row = await db.meta.get(key);
    return row ? row.value : fallback;
}

export function setMeta(key, value) {
    return db.meta.put({ key, value });
}

export function deleteMeta(key) {
    return db.meta.delete(key);
}
