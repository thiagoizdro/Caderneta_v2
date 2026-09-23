import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { materializeRecurrences } from './lib/bootstrap.js';
import { runDailyReminders } from './lib/notify.js';
import { startAutoSync } from './lib/sync.js';
import { NAV_GROUPS, NAV_ITEMS } from './components/nav.js';
import { Icon } from './components/Icon.jsx';
import { SearchPalette } from './components/SearchPalette.jsx';
import { TransactionForm } from './components/TransactionForm.jsx';
import { ConfirmDialog, Modal, Toasts } from './components/ui.jsx';
import { UIContext, navigate, useData, useRoute, useSyncState, useUI } from './state.jsx';
import { Accounts } from './pages/Accounts.jsx';
import { Budget } from './pages/Budget.jsx';
import { CalendarPage } from './pages/CalendarPage.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { Goals } from './pages/Goals.jsx';
import { More } from './pages/More.jsx';
import { Onboarding } from './pages/Onboarding.jsx';
import { Recurring } from './pages/Recurring.jsx';
import { Reports } from './pages/Reports.jsx';
import { Settings } from './pages/Settings.jsx';
import { Transactions } from './pages/Transactions.jsx';

const ROUTES = {
    '/': Dashboard,
    '/lancamentos': Transactions,
    '/calendario': CalendarPage,
    '/contas': Accounts,
    '/recorrentes': Recurring,
    '/orcamento': Budget,
    '/metas': Goals,
    '/relatorios': Reports,
    '/ajustes': Settings,
    '/mais': More,
};

function Sidebar({ path }) {
    const ui = useUI();
    const sync = useSyncState();
    let lastGroup = null;
    return (
        <aside className="sidebar" aria-label="Navegação principal">
            <a href="#/" className="brand">
                <span className="brand-stamp">R$</span>
                <span>
                    <span className="brand-name">Caderneta</span>
                    <span className="brand-sub" style={{ display: 'block' }}>Controle financeiro</span>
                </span>
            </a>
            <button className="sidebar-cta" onClick={() => ui.openTx()}>
                <Plus size={18} aria-hidden="true" /> Novo lançamento <kbd>N</kbd>
            </button>
            <nav>
                {NAV_ITEMS.map((item) => {
                    const header = item.group !== lastGroup && NAV_GROUPS[item.group]
                        ? <div className="nav-section">{NAV_GROUPS[item.group]}</div> : null;
                    lastGroup = item.group;
                    return (
                        <div key={item.path}>
                            {header}
                            <a href={`#${item.path}`} className={`nav-link${path === item.path ? ' active' : ''}`} aria-current={path === item.path ? 'page' : undefined}>
                                <Icon name={item.icon} size={18} /> {item.label}
                            </a>
                        </div>
                    );
                })}
            </nav>
            <div className="sidebar-footer">
                {sync.user ? (
                    <a href="#/ajustes?secao=conta" className="sidebar-user" style={{ textDecoration: 'none' }}>
                        <span className="avatar">{sync.user.name.slice(0, 1).toUpperCase()}</span>
                        <span style={{ minWidth: 0 }}>
                            <strong style={{ display: 'block' }}>{sync.user.name}</strong>
                            <span style={{ color: 'var(--sidebar-muted)', fontSize: 12 }}>{sync.user.email}</span>
                        </span>
                    </a>
                ) : (
                    <a href="#/ajustes?secao=conta" className="nav-link"><Icon name="settings" size={16} /> Entrar para sincronizar</a>
                )}
            </div>
        </aside>
    );
}

function BottomNav({ path }) {
    const ui = useUI();
    const items = [NAV_ITEMS[0], NAV_ITEMS[1], null, NAV_ITEMS[2], { path: '/mais', label: 'Mais', icon: 'menu' }];
    const inMore = !['/', '/lancamentos', '/calendario'].includes(path);
    return (
        <nav className="bottom-nav" aria-label="Navegação">
            {items.map((item) => item ? (
                <a
                    key={item.path}
                    href={`#${item.path}`}
                    className={`bottom-link${path === item.path || (item.path === '/mais' && inMore) ? ' active' : ''}`}
                    aria-current={path === item.path ? 'page' : undefined}
                >
                    <Icon name={item.icon} size={21} />
                    {item.label === 'Lançamentos' ? 'Extrato' : item.label}
                </a>
            ) : (
                <button key="fab" className="bottom-fab" onClick={() => ui.openTx()} aria-label="Novo lançamento">
                    <Plus size={26} strokeWidth={2.5} />
                </button>
            ))}
        </nav>
    );
}

// ------------------------------------------------------------
// Aviso de nova versão do PWA
// ------------------------------------------------------------

function useServiceWorker(toast) {
    useEffect(() => {
        if (import.meta.env.DEV) return;
        let cancelled = false;
        import('virtual:pwa-register').then(({ registerSW }) => {
            if (cancelled) return;
            const update = registerSW({
                onNeedRefresh() {
                    toast('Nova versão do Caderneta disponível.', 'info', { label: 'Atualizar', run: () => update(true) }, 15000);
                },
                onOfflineReady() {
                    toast('Pronto para funcionar offline.', 'success');
                },
            });
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [toast]);
}

// ------------------------------------------------------------
// App
// ------------------------------------------------------------

export function App({ migrated, bootError }) {
    const data = useData();
    const { path, params } = useRoute();
    const [toasts, setToasts] = useState([]);
    const [txModal, setTxModal] = useState(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [dialog, setDialog] = useState(null);
    const bootstrapped = useRef(false);

    const toast = useCallback((message, type = 'info', action = null, duration) => {
        const id = Math.random().toString(36).slice(2);
        setToasts((list) => [...list.slice(-2), { id, message, type, action }]);
        setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), duration ?? (action ? 6000 : 3200));
    }, []);

    const ui = useMemo(() => ({
        toast,
        openTx: (initial = {}) => setTxModal({ key: Date.now(), initial }),
        openSearch: () => setSearchOpen(true),
        confirm: (opts) => new Promise((resolve) => setDialog({ kind: 'confirm', opts, resolve })),
        choose: (opts) => new Promise((resolve) => setDialog({ kind: 'choose', opts, resolve })),
    }), [toast]);

    useServiceWorker(toast);

    // Inicialização: padrões, migração da v1, recorrências vencidas e sincronização.
    useEffect(() => {
        if (bootstrapped.current) return;
        bootstrapped.current = true;
        if (bootError) toast('Não foi possível abrir o banco local deste navegador.', 'error', null, 10000);
        if (migrated) toast(`Dados da versão anterior importados (${migrated.transactions} lançamentos).`, 'success', null, 6000);
        materializeRecurrences().finally(startAutoSync);
    }, [toast, migrated, bootError]);

    // Recorrências que vencem com o app aberto (virada do dia) e lembretes.
    useEffect(() => {
        if (!data.profile?.onboarded) return;
        materializeRecurrences(data.today);
        runDailyReminders({
            accounts: data.accounts, txs: data.transactions, recurrences: data.recurrences,
            categories: data.categories, settings: data.profile,
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.today, data.profile?.onboarded]);

    // Atalhos: Ctrl/⌘+K busca, N novo lançamento.
    useEffect(() => {
        const onKey = (e) => {
            const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setSearchOpen(true);
            } else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'n' && !txModal && !searchOpen && !dialog) {
                e.preventDefault();
                ui.openTx();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [ui, txModal, searchOpen, dialog]);

    // Atalho do PWA / links: #/lancamentos?novo=1
    useEffect(() => {
        if (params.novo === '1') {
            ui.openTx();
            navigate(path);
        }
    }, [params.novo, path, ui]);

    const closeTx = useCallback(() => setTxModal(null), []);
    const closeSearch = useCallback(() => setSearchOpen(false), []);

    const Page = ROUTES[path] || Dashboard;
    const onboarded = data.profile?.onboarded;

    return (
        <UIContext.Provider value={ui}>
            {onboarded ? (
                <div className="shell">
                    <Sidebar path={path} />
                    <main className="main" id="conteudo">
                        <Page params={params} key={path} />
                    </main>
                    <BottomNav path={path} />
                </div>
            ) : (
                <Onboarding />
            )}

            {txModal && <TransactionForm key={txModal.key} initial={txModal.initial} onClose={closeTx} />}
            {searchOpen && (
                <SearchPalette
                    onClose={closeSearch}
                    onOpenTx={(tx) => ui.openTx(tx)}
                    onNewTx={() => ui.openTx()}
                />
            )}
            {dialog?.kind === 'confirm' && (
                <ConfirmDialog {...dialog.opts} onResult={(r) => { setDialog(null); dialog.resolve(r); }} />
            )}
            {dialog?.kind === 'choose' && (
                <Modal title={dialog.opts.title} onClose={() => { setDialog(null); dialog.resolve(null); }}>
                    {dialog.opts.message && <p className="soft">{dialog.opts.message}</p>}
                    <div className="stack mt">
                        {dialog.opts.options.map((o) => (
                            <button key={o.id} className={`btn btn-block ${o.danger ? 'btn-danger' : 'btn-secondary'}`} onClick={() => { setDialog(null); dialog.resolve(o.id); }}>
                                {o.label}
                            </button>
                        ))}
                    </div>
                </Modal>
            )}
            <Toasts items={toasts} onDismiss={(id) => setToasts((l) => l.filter((t) => t.id !== id))} />
        </UIContext.Provider>
    );
}
