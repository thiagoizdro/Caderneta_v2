import { Download, Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Topbar } from '../components/Topbar.jsx';
import { TransactionRow } from '../components/TransactionForm.jsx';
import { EmptyState, MonthPicker } from '../components/ui.jsx';
import { exportTransactionsCsv } from '../lib/backup.js';
import { endOfMonth, monthOf, startOfMonth } from '../lib/dates.js';
import { longDate, money, round2 } from '../lib/format.js';
import { useData, useUI } from '../state.jsx';

const normalize = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const PAGE = 60;

const PERIODS = [
    { id: 'month', label: 'Mês' },
    { id: 'range', label: 'Período' },
    { id: 'all', label: 'Histórico' },
];

export function Transactions({ params }) {
    const data = useData();
    const ui = useUI();
    const { transactions, categories, accounts, today } = data;

    const [type, setType] = useState(params.tipo || 'all');
    const [period, setPeriod] = useState(params.mes || !params.categoria ? 'month' : 'all');
    const [month, setMonth] = useState(params.mes || monthOf(today));
    const [from, setFrom] = useState(startOfMonth(monthOf(today)));
    const [to, setTo] = useState(today);
    const [categoryId, setCategoryId] = useState(params.categoria || '');
    const [accountId, setAccountId] = useState(params.conta || '');
    const [extra, setExtra] = useState('');
    const [query, setQuery] = useState('');
    const [moreFilters, setMoreFilters] = useState(Boolean(params.conta));
    const [limit, setLimit] = useState(PAGE);

    const hasTransfers = useMemo(() => transactions.some((t) => t.type === 'transfer'), [transactions]);
    const tabs = [
        { id: 'income', label: 'Receitas' },
        { id: 'expense', label: 'Despesas' },
        { id: 'all', label: 'Tudo' },
        ...(hasTransfers ? [{ id: 'transfer', label: 'Transferências' }] : []),
    ];

    // Filtros que definem o período (os totais do topo usam só período + busca + categoria/conta).
    const inPeriod = useMemo(() => {
        if (period === 'all') return () => true;
        const lo = period === 'month' ? startOfMonth(month) : from || '0000-01-01';
        const hi = period === 'month' ? endOfMonth(month) : to || '9999-12-31';
        return (t) => t.date >= lo && t.date <= hi;
    }, [period, month, from, to]);

    const base = useMemo(() => {
        const q = normalize(query.trim());
        const amountQ = Number(query.replace(/\./g, '').replace(',', '.'));
        return transactions.filter((t) => {
            if (!inPeriod(t)) return false;
            if (categoryId && t.categoryId !== categoryId) return false;
            if (accountId && t.accountId !== accountId && t.toAccountId !== accountId) return false;
            if (extra === 'third' && !t.person) return false;
            if (extra === 'installment' && !t.installment) return false;
            if (extra === 'recurring' && t.source !== 'recurrence') return false;
            if (extra === 'scheduled' && t.date <= today) return false;
            if (extra === 'workday' && !(Number(t.workdayAmount) > 0)) return false;
            if (q) {
                const cat = data.categoryById.get(t.categoryId);
                const hit = normalize(t.description).includes(q) || normalize(t.person).includes(q)
                    || normalize(t.notes).includes(q) || normalize(cat?.name).includes(q)
                    || (amountQ > 0 && Math.abs(t.amount - amountQ) < 0.005);
                if (!hit) return false;
            }
            return true;
        });
    }, [transactions, inPeriod, categoryId, accountId, extra, query, today, data.categoryById]);

    const totals = useMemo(() => {
        let income = 0;
        let expense = 0;
        for (const t of base) {
            if (t.type === 'income') income += t.amount;
            else if (t.type === 'expense') expense += t.amount;
        }
        return { income: round2(income), expense: round2(expense), net: round2(income - expense) };
    }, [base]);

    const filtered = useMemo(() => (type === 'all' ? base : base.filter((t) => t.type === type)), [base, type]);

    const groups = useMemo(() => {
        const out = [];
        for (const t of filtered.slice(0, limit)) {
            let g = out[out.length - 1];
            if (!g || g.date !== t.date) {
                g = { date: t.date, items: [], net: 0 };
                out.push(g);
            }
            g.items.push(t);
            g.net += t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0;
        }
        return out;
    }, [filtered, limit]);

    const kindCategories = type === 'income' || type === 'expense' ? categories.filter((c) => c.kind === type) : categories;
    const hasFilters = categoryId || accountId || extra || query;
    const clear = () => { setCategoryId(''); setAccountId(''); setExtra(''); setQuery(''); };
    const changeType = (id) => {
        setType(id);
        setLimit(PAGE);
        if (categoryId && (id === 'income' || id === 'expense') && data.categoryById.get(categoryId)?.kind !== id) setCategoryId('');
    };

    return (
        <div className="page">
            <Topbar eyebrow="Dinheiro real" title="Movimentações">
                <button className="btn-icon" onClick={() => exportTransactionsCsv(filtered, data)} aria-label="Exportar CSV" title="Exportar CSV (Excel)">
                    <Download size={19} />
                </button>
            </Topbar>

            <div className="tx-totals" aria-live="polite">
                <button className={`card tx-total income${type === 'income' ? ' active' : ''}`} onClick={() => changeType('income')}>
                    <span>Recebido</span><b className="num">{money(totals.income)}</b>
                </button>
                <button className={`card tx-total expense${type === 'expense' ? ' active' : ''}`} onClick={() => changeType('expense')}>
                    <span>Gasto</span><b className="num">{money(totals.expense)}</b>
                </button>
                <button className={`card tx-total${type === 'all' ? ' active' : ''}`} onClick={() => changeType('all')}>
                    <span>Resultado</span><b className={`num ${totals.net < 0 ? 'neg' : ''}`}>{money(totals.net)}</b>
                </button>
            </div>

            <div className="card stack">
                <div className="tabs" role="tablist" aria-label="Tipo">
                    {tabs.map((t) => (
                        <button key={t.id} role="tab" aria-selected={type === t.id} className={type === t.id ? 'active' : ''} onClick={() => changeType(t.id)}>{t.label}</button>
                    ))}
                </div>
                <div className="toolbar">
                    <div className="segmented period-switch" role="radiogroup" aria-label="Período">
                        {PERIODS.map((p) => (
                            <button key={p.id} type="button" role="radio" aria-checked={period === p.id} className={period === p.id ? 'active' : ''} onClick={() => { setPeriod(p.id); setLimit(PAGE); }}>{p.label}</button>
                        ))}
                    </div>
                    {period === 'month' && <MonthPicker value={month} onChange={(m) => { setMonth(m); setLimit(PAGE); }} />}
                    {period === 'range' && (
                        <div className="range-fields">
                            <input type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="De" />
                            <span className="muted">até</span>
                            <input type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="Até" />
                        </div>
                    )}
                </div>
                <div className="toolbar">
                    <div className="search-field grow">
                        <Search size={16} />
                        <input className="input" type="search" placeholder="Buscar descrição, categoria ou valor" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar movimentações" />
                    </div>
                    <select className="filter-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Categoria">
                        <option value="">Todas as categorias</option>
                        {kindCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button className={`btn btn-ghost btn-sm${moreFilters ? ' active' : ''}`} onClick={() => setMoreFilters(!moreFilters)} aria-expanded={moreFilters}>
                        <SlidersHorizontal size={15} /> Filtros
                    </button>
                </div>
                {moreFilters && (
                    <div className="toolbar">
                        <select className="filter-select" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Conta">
                            <option value="">Todas as contas</option>
                            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                        <select className="filter-select" value={extra} onChange={(e) => setExtra(e.target.value)} aria-label="Mais filtros">
                            <option value="">Qualquer origem</option>
                            <option value="workday">Recebimentos de diárias</option>
                            <option value="third">Repasses a terceiros</option>
                            <option value="installment">Parcelas</option>
                            <option value="recurring">Recorrentes</option>
                            <option value="scheduled">Agendadas (futuras)</option>
                        </select>
                    </div>
                )}
                {hasFilters && (
                    <div className="row between">
                        <span className="hint">{filtered.length} {filtered.length === 1 ? 'movimentação' : 'movimentações'} com esses filtros</span>
                        <button className="btn btn-ghost btn-sm" onClick={clear}><X size={14} /> Limpar</button>
                    </div>
                )}
            </div>

            <div className="card">
                {groups.length ? groups.map((g) => (
                    <div className="day-group" key={g.date}>
                        <div className="day-head">
                            <span>{longDate(g.date)}</span>
                            <span className={`num ${g.net < 0 ? '' : 'pos'}`}>{Math.abs(g.net) > 0.004 ? money(g.net) : ''}</span>
                        </div>
                        <div className="list">
                            {g.items.map((t) => <TransactionRow key={t.id} tx={t} onClick={ui.openTx} />)}
                        </div>
                    </div>
                )) : (
                    <EmptyState
                        icon={hasFilters ? 'receipt' : 'plus'}
                        title={hasFilters ? 'Nada com esses filtros' : 'Nenhuma movimentação neste período'}
                        action={hasFilters
                            ? <button className="btn btn-secondary" onClick={clear}>Limpar filtros</button>
                            : <button className="btn btn-primary" onClick={() => ui.openTx({ type: type === 'income' ? 'income' : 'expense', date: period === 'month' && month !== monthOf(today) ? `${month}-01` : today })}><Plus size={16} /> Nova movimentação</button>}
                    >
                        {hasFilters ? 'Tente outro termo, período ou categoria.' : 'Registre receitas e despesas para acompanhar o período.'}
                    </EmptyState>
                )}
                {filtered.length > limit && (
                    <button className="btn btn-secondary btn-block mt" onClick={() => setLimit(limit + PAGE)}>
                        Mostrar mais ({filtered.length - limit} restantes)
                    </button>
                )}
            </div>
        </div>
    );
}
