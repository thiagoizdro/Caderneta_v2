import { Download, Plus, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Topbar } from '../components/Topbar.jsx';
import { TransactionRow } from '../components/TransactionForm.jsx';
import { EmptyState, MonthPicker } from '../components/ui.jsx';
import { exportTransactionsCsv } from '../lib/backup.js';
import { monthOf } from '../lib/dates.js';
import { longDate, money } from '../lib/format.js';
import { useData, useUI } from '../state.jsx';

const normalize = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const TYPE_FILTERS = [
    { id: 'all', label: 'Tudo' },
    { id: 'expense', label: 'Despesas' },
    { id: 'income', label: 'Receitas' },
    { id: 'transfer', label: 'Transferências' },
];

export function Transactions({ params }) {
    const data = useData();
    const ui = useUI();
    const { transactions, categories, accounts, today } = data;

    const [month, setMonth] = useState(params.mes || monthOf(today));
    const [allMonths, setAllMonths] = useState(false);
    const [type, setType] = useState(params.tipo || 'all');
    const [categoryId, setCategoryId] = useState(params.categoria || '');
    const [accountId, setAccountId] = useState(params.conta || '');
    const [extra, setExtra] = useState('');
    const [query, setQuery] = useState('');

    const filtered = useMemo(() => {
        const q = normalize(query.trim());
        const amountQ = Number(query.replace(/\./g, '').replace(',', '.'));
        return transactions.filter((t) => {
            if (!allMonths && !t.date.startsWith(month)) return false;
            if (type !== 'all' && t.type !== type) return false;
            if (categoryId && t.categoryId !== categoryId) return false;
            if (accountId && t.accountId !== accountId && t.toAccountId !== accountId) return false;
            if (extra === 'third' && !t.person) return false;
            if (extra === 'installment' && !t.installment) return false;
            if (extra === 'recurring' && t.source !== 'recurrence') return false;
            if (extra === 'scheduled' && t.date <= today) return false;
            if (q) {
                const cat = data.categoryById.get(t.categoryId);
                const hit = normalize(t.description).includes(q) || normalize(t.person).includes(q)
                    || normalize(t.notes).includes(q) || normalize(cat?.name).includes(q)
                    || (amountQ > 0 && Math.abs(t.amount - amountQ) < 0.005);
                if (!hit) return false;
            }
            return true;
        });
    }, [transactions, month, allMonths, type, categoryId, accountId, extra, query, today, data.categoryById]);

    const totals = useMemo(() => {
        let income = 0;
        let expense = 0;
        for (const t of filtered) {
            if (t.type === 'income') income += t.amount;
            else if (t.type === 'expense') expense += t.amount;
        }
        return { income, expense, net: income - expense };
    }, [filtered]);

    const groups = useMemo(() => {
        const out = [];
        for (const t of filtered.slice(0, 600)) {
            let g = out[out.length - 1];
            if (!g || g.date !== t.date) {
                g = { date: t.date, items: [], net: 0 };
                out.push(g);
            }
            g.items.push(t);
            g.net += t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : 0;
        }
        return out;
    }, [filtered]);

    const hasFilters = type !== 'all' || categoryId || accountId || extra || query;
    const clear = () => { setType('all'); setCategoryId(''); setAccountId(''); setExtra(''); setQuery(''); };

    return (
        <div className="page">
            <Topbar eyebrow="Extrato" title="Lançamentos">
                <button className="btn-icon" onClick={() => exportTransactionsCsv(filtered, data)} aria-label="Exportar CSV" title="Exportar CSV (Excel)">
                    <Download size={19} />
                </button>
            </Topbar>

            <div className="card stack">
                <div className="toolbar">
                    {allMonths
                        ? <button className="btn btn-secondary btn-sm" onClick={() => setAllMonths(false)}>Todos os meses <X size={14} /></button>
                        : <MonthPicker value={month} onChange={setMonth} />}
                    {!allMonths && <button className="btn btn-ghost btn-sm" onClick={() => setAllMonths(true)}>Ver todos os meses</button>}
                    <div className="search-field grow">
                        <Search size={16} />
                        <input className="input" type="search" placeholder="Descrição, pessoa, categoria ou valor" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar lançamentos" />
                    </div>
                </div>
                <div className="toolbar">
                    <div className="chips" role="radiogroup" aria-label="Tipo">
                        {TYPE_FILTERS.map((f) => (
                            <button key={f.id} role="radio" aria-checked={type === f.id} className={`chip${type === f.id ? ' active' : ''}`} onClick={() => setType(f.id)}>{f.label}</button>
                        ))}
                    </div>
                    <select className="filter-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Categoria">
                        <option value="">Todas as categorias</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <select className="filter-select" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Conta">
                        <option value="">Todas as contas</option>
                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <select className="filter-select" value={extra} onChange={(e) => setExtra(e.target.value)} aria-label="Mais filtros">
                        <option value="">Qualquer origem</option>
                        <option value="third">Repasses a terceiros</option>
                        <option value="installment">Parcelas</option>
                        <option value="recurring">Recorrentes</option>
                        <option value="scheduled">Agendados (futuros)</option>
                    </select>
                    {hasFilters && <button className="btn btn-ghost btn-sm" onClick={clear}><X size={14} /> Limpar</button>}
                </div>
                <div className="summary-strip" aria-live="polite">
                    <span>{filtered.length} {filtered.length === 1 ? 'lançamento' : 'lançamentos'}</span>
                    <span>Entradas <b className="pos">{money(totals.income)}</b></span>
                    <span>Saídas <b>{money(totals.expense)}</b></span>
                    <span>Resultado <b className={totals.net < 0 ? 'neg' : ''}>{money(totals.net)}</b></span>
                </div>
            </div>

            <div className="card">
                {groups.length ? groups.map((g) => (
                    <div className="day-group" key={g.date}>
                        <div className="day-head">
                            <span>{longDate(g.date)}</span>
                            <span className={`num ${g.net < 0 ? '' : 'pos'}`}>{g.net !== 0 ? money(g.net) : ''}</span>
                        </div>
                        <div className="list">
                            {g.items.map((t) => <TransactionRow key={t.id} tx={t} onClick={ui.openTx} />)}
                        </div>
                    </div>
                )) : (
                    <EmptyState
                        icon={hasFilters ? 'receipt' : 'plus'}
                        title={hasFilters ? 'Nada com esses filtros' : 'Nenhum lançamento neste mês'}
                        action={hasFilters
                            ? <button className="btn btn-secondary" onClick={clear}>Limpar filtros</button>
                            : <button className="btn btn-primary" onClick={() => ui.openTx({ date: month === monthOf(today) ? today : `${month}-01` })}><Plus size={16} /> Novo lançamento</button>}
                    >
                        {hasFilters ? 'Tente outro termo, mês ou categoria.' : 'Registre gastos e receitas para acompanhar o mês.'}
                    </EmptyState>
                )}
                {filtered.length > 600 && <p className="hint center mt">Mostrando os 600 mais recentes. Use os filtros para refinar.</p>}
            </div>
        </div>
    );
}
