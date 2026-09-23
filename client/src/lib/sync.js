// Sincronização offline-first.
//
// O aparelho é a fonte da verdade para o uso diário: tudo é gravado no
// IndexedDB primeiro e marcado como pendente. Quando há sessão e internet,
// as pendências sobem e as novidades de outros aparelhos descem, em lotes,
// até não sobrar nada. Conflitos: vence a alteração mais recente (updatedAt).

import { ApiError, apiFetch } from './api.js';
import { COLLECTIONS, META_FIELDS, db, deleteMeta, getMeta, setMeta } from './db.js';
import { onLocalChange } from './store.js';

const BATCH = 500;
const INTERVAL_MS = 60 * 1000;
const DEBOUNCE_MS = 1500;

let state = { status: 'local', lastSync: null, error: null, user: null, pending: 0 };
const listeners = new Set();

function setState(patch) {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
}

export function subscribeSync(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function getSyncState() {
    return state;
}

export async function getSession() {
    return getMeta('session');
}

async function countPending() {
    const counts = await Promise.all(COLLECTIONS.map((c) => db.table(c).where('_pending').equals(1).count()));
    return counts.reduce((a, b) => a + b, 0);
}

function toChange(collection, record) {
    const data = { ...record };
    META_FIELDS.forEach((f) => delete data[f]);
    return { collection, id: record.id, updatedAt: record.updatedAt, deleted: record.deleted === 1, data };
}

async function collectPending(limit) {
    const out = [];
    for (const collection of COLLECTIONS) {
        if (out.length >= limit) break;
        const rows = await db.table(collection).where('_pending').equals(1).limit(limit - out.length).toArray();
        rows.forEach((r) => out.push(toChange(collection, r)));
    }
    return out;
}

/** Aplica a resposta: limpa pendências confirmadas e grava o que veio do servidor. */
async function applyResponse(sent, received) {
    const tables = [...COLLECTIONS.map((c) => db.table(c)), db.meta];
    await db.transaction('rw', tables, async () => {
        for (const change of sent) {
            const table = db.table(change.collection);
            const local = await table.get(change.id);
            // Só limpa se o registro não mudou de novo enquanto a requisição viajava.
            if (local && local.updatedAt === change.updatedAt) await table.update(change.id, { _pending: 0 });
        }
        for (const change of received) {
            const table = db.table(change.collection);
            const local = await table.get(change.id);
            if (local && local._pending === 1 && local.updatedAt > change.updatedAt) continue;
            await table.put({
                ...change.data,
                id: change.id,
                updatedAt: change.updatedAt,
                deleted: change.deleted ? 1 : 0,
                _pending: 0,
            });
        }
    });
}

let running = null;

export function syncNow() {
    if (!running) running = runSync().finally(() => { running = null; });
    return running;
}

async function runSync() {
    const session = await getSession();
    if (!session) {
        setState({ status: 'local', user: null, pending: await countPending() });
        return;
    }
    setState({ user: session.user });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setState({ status: 'offline', pending: await countPending() });
        return;
    }

    setState({ status: 'syncing', error: null });
    try {
        let cursor = (await getMeta('cursor')) || 0;
        for (let round = 0; round < 50; round++) {
            const sent = await collectPending(BATCH);
            const res = await apiFetch('/sync', { method: 'POST', token: session.token, body: { cursor, changes: sent } });
            await applyResponse(sent, res.changes);
            cursor = res.cursor;
            await setMeta('cursor', cursor);
            if (!res.hasMore && sent.length < BATCH) break;
        }
        setState({ status: 'synced', lastSync: Date.now(), pending: await countPending() });
    } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
            setState({ status: 'expired', error: 'Sua sessão expirou. Entre novamente para continuar sincronizando.' });
        } else {
            setState({ status: error.status === 0 ? 'offline' : 'error', error: error.message, pending: await countPending() });
        }
    }
}

// ------------------------------------------------------------
// Sessão
// ------------------------------------------------------------

async function startSession({ token, user }) {
    await setMeta('session', { token, user });
    await deleteMeta('cursor');
    setState({ user, status: 'syncing' });
    await syncNow();
}

export async function login(email, password) {
    await startSession(await apiFetch('/auth/login', { method: 'POST', body: { email, password } }));
}

export async function register(name, email, password) {
    await startSession(await apiFetch('/auth/register', { method: 'POST', body: { name, email, password } }));
}

/** Sai da conta e apaga os dados deste aparelho (eles continuam na nuvem). */
export async function logout() {
    const session = await getSession();
    if (session) {
        await syncNow();
        await apiFetch('/auth/logout', { method: 'POST', token: session.token }).catch(() => {});
    }
    await wipeLocalData();
}

export async function deleteAccount(password) {
    const session = await getSession();
    await apiFetch('/auth/account', { method: 'DELETE', token: session.token, body: { password } });
    await wipeLocalData();
}

export async function wipeLocalData() {
    await db.transaction('rw', [...COLLECTIONS.map((c) => db.table(c)), db.meta], async () => {
        await Promise.all([...COLLECTIONS.map((c) => db.table(c).clear()), db.meta.clear()]);
    });
    setState({ status: 'local', user: null, lastSync: null, error: null, pending: 0 });
}

// ------------------------------------------------------------
// Agendamento automático
// ------------------------------------------------------------

let started = false;

export function startAutoSync() {
    if (started) return;
    started = true;

    let debounce;
    onLocalChange(() => {
        countPending().then((pending) => setState({ pending }));
        clearTimeout(debounce);
        debounce = setTimeout(syncNow, DEBOUNCE_MS);
    });
    window.addEventListener('online', () => syncNow());
    window.addEventListener('offline', () => state.user && setState({ status: 'offline' }));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') syncNow();
    });
    setInterval(() => {
        if (document.visibilityState === 'visible') syncNow();
    }, INTERVAL_MS);

    syncNow();
}
