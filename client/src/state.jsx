import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { COLLECTIONS, db } from './lib/db.js';
import { todayISO } from './lib/dates.js';
import { PROFILE_ID } from './lib/defaults.js';
import { getSyncState, subscribeSync } from './lib/sync.js';

// ------------------------------------------------------------
// Dados: tudo o que está no IndexedDB, reativo (useLiveQuery)
// ------------------------------------------------------------

const DataContext = createContext(null);

function useToday() {
    const [today, setToday] = useState(todayISO);
    useEffect(() => {
        const tick = () => setToday(todayISO());
        const id = setInterval(tick, 60 * 1000);
        document.addEventListener('visibilitychange', tick);
        return () => {
            clearInterval(id);
            document.removeEventListener('visibilitychange', tick);
        };
    }, []);
    return today;
}

const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');

export function DataProvider({ children }) {
    const raw = useLiveQuery(async () => {
        const entries = await Promise.all(COLLECTIONS.map(async (c) => [c, await db.table(c).toArray()]));
        return Object.fromEntries(entries);
    }, []);
    const today = useToday();

    const value = useMemo(() => {
        if (!raw) return null;
        const alive = (rows) => rows.filter((r) => !r.deleted);
        const accountsAll = alive(raw.accounts).sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || byName(a, b));
        const categoriesAll = alive(raw.categories).sort(byName);
        const transactions = alive(raw.transactions).sort((a, b) =>
            (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));

        return {
            today,
            profile: alive(raw.settings).find((s) => s.id === PROFILE_ID) || null,
            accounts: accountsAll,
            activeAccounts: accountsAll.filter((a) => !a.archived),
            categories: categoriesAll.filter((c) => !c.archived),
            allCategories: categoriesAll,
            transactions,
            recurrences: alive(raw.recurrences),
            goals: alive(raw.goals).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
            goalDeposits: alive(raw.goalDeposits),
            accountById: new Map(accountsAll.map((a) => [a.id, a])),
            categoryById: new Map(categoriesAll.map((c) => [c.id, c])),
            // Inclui excluídos: usado para não recriar ocorrências apagadas.
            knownTxIds: new Set(raw.transactions.map((t) => t.id)),
        };
    }, [raw, today]);

    if (!value) return null;
    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
    return useContext(DataContext);
}

// ------------------------------------------------------------
// Rotas (hash): #/lancamentos?categoria=x
// ------------------------------------------------------------

function parseHash() {
    const raw = window.location.hash.replace(/^#/, '') || '/';
    const [path, query = ''] = raw.split('?');
    return { path: path || '/', params: Object.fromEntries(new URLSearchParams(query)) };
}

export function useRoute() {
    const [route, setRoute] = useState(parseHash);
    useEffect(() => {
        const onChange = () => {
            setRoute(parseHash());
            window.scrollTo({ top: 0 });
        };
        window.addEventListener('hashchange', onChange);
        return () => window.removeEventListener('hashchange', onChange);
    }, []);
    return route;
}

export function navigate(path, params) {
    const query = params ? `?${new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''))}` : '';
    window.location.hash = `${path}${query === '?' ? '' : query}`;
}

// ------------------------------------------------------------
// Sincronização
// ------------------------------------------------------------

export function useSyncState() {
    return useSyncExternalStore(subscribeSync, getSyncState);
}

// ------------------------------------------------------------
// UI global: toasts, modais, busca
// ------------------------------------------------------------

export const UIContext = createContext(null);

export function useUI() {
    return useContext(UIContext);
}
