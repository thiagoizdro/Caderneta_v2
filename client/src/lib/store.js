// Escritas locais. Toda alteração passa por aqui para ganhar os campos de
// controle (updatedAt, deleted, _pending) e avisar o sincronizador.

import { db } from './db.js';

const listeners = new Set();

export function onLocalChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function emit() {
    listeners.forEach((fn) => fn());
}

export function newId(prefix = '') {
    return prefix + crypto.randomUUID();
}

/** Garante que o novo updatedAt seja maior que o anterior, mesmo com relógio atrasado. */
function nextStamp(previous, forced) {
    if (forced != null) return forced;
    return Math.max(Date.now(), (previous?.updatedAt || 0) + 1);
}

export async function save(collection, record, { updatedAt } = {}) {
    const [saved] = await saveMany(collection, [record], { updatedAt });
    return saved;
}

/** `updatedAt` fixo é usado por registros gerados automaticamente (ver bootstrap.js). */
export async function saveMany(collection, records, { updatedAt } = {}) {
    if (!records.length) return [];
    const table = db.table(collection);
    const out = await db.transaction('rw', table, async () => {
        const ids = records.map((r) => r.id).filter(Boolean);
        const existing = new Map((await table.bulkGet(ids)).filter(Boolean).map((r) => [r.id, r]));
        const now = Date.now();
        const rows = records.map((record) => {
            const prev = record.id ? existing.get(record.id) : null;
            const { _pending, deleted, ...data } = record;
            return {
                createdAt: prev?.createdAt ?? now,
                ...data,
                id: record.id || newId(),
                updatedAt: nextStamp(prev, updatedAt),
                deleted: 0,
                _pending: 1,
            };
        });
        await table.bulkPut(rows);
        return rows;
    });
    emit();
    return out;
}

export async function update(collection, id, patch) {
    const current = await db.table(collection).get(id);
    if (!current) return null;
    return save(collection, { ...current, ...patch });
}

export async function remove(collection, id) {
    return removeMany(collection, [id]);
}

export async function removeMany(collection, ids) {
    if (!ids.length) return;
    const table = db.table(collection);
    await db.transaction('rw', table, async () => {
        const rows = (await table.bulkGet(ids)).filter(Boolean);
        await table.bulkPut(rows.map((r) => ({ ...r, deleted: 1, _pending: 1, updatedAt: nextStamp(r) })));
    });
    emit();
}
