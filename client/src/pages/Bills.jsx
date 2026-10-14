import { CalendarClock, CircleCheck, Minus, PiggyBank, Plus, Receipt, Repeat, Target, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Topbar } from '../components/Topbar.jsx';
import { BillDetail, BillForm, BillStatusTag, ReserveForm, billColor, dueText } from '../components/BillForms.jsx';
import { Icon } from '../components/Icon.jsx';
import { AnimatedMoney, EmptyState, MonthPicker, Progress } from '../components/ui.jsx';
import { monthLabel, monthOf } from '../lib/dates.js';
import { BILL_CATEGORIES } from '../lib/defaults.js';
import { BILL_STATUS, billsPaidInMonth, cashBalance } from '../lib/finance.js';
import { money, percent, round2, shortDate } from '../lib/format.js';
import { remove } from '../lib/store.js';
import { useData, useUI } from '../state.jsx';

function Kpi({ label, icon: I, value, foot, hero = false }) {
    return (
        <div className={`card kpi${hero ? ' hero' : ''}`}>
            <span className="kpi-label"><I size={15} aria-hidden="true" /> {label}</span>
            <span className="kpi-value"><AnimatedMoney value={value} /></span>
            {foot && <span className="kpi-foot">{foot}</span>}
        </div>
    );
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const VIEWS = [
    { id: 'open', label: 'Todas pendentes' },
    { id: 'month', label: 'Por mês' },
    { id: 'all', label: 'Todas' },
];

// ------------------------------------------------------------
// Reserva
// ------------------------------------------------------------

function ReserveCard({ onMove }) {
    const { billLedger, billPayments, reserveMoves, accounts, transactions, today } = useData();
    const t = billLedger.totals;
    const [history, setHistory] = useState(false);
    const cash = useMemo(() => cashBalance(accounts, transactions, today), [accounts, transactions, today]);
    const reserve = Math.max(t.reserve, 0);

    // Depósitos/retiradas e o que os pagamentos usaram da reserva, mais recentes primeiro.
    const moves = useMemo(() => {
        const names = new Map(billLedger.bills.map((e) => [e.id, e.bill.description]));
        return [
            ...reserveMoves.map((m) => ({ key: m.id, id: m.id, date: m.date, amount: m.amount, label: m.note || (m.amount < 0 ? 'Retirada' : 'Depósito') })),
            ...billPayments.filter((p) => p.fromReserve > 0).map((p) => ({ key: p.id, date: p.date, amount: -p.fromReserve, label: `Pagamento: ${names.get(p.billId) || 'conta'}` })),
        ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    }, [reserveMoves, billPayments, billLedger]);

    return (
        <div className="card stack">
            <div className="card-head">
                <h2>Reserva para as contas</h2>
                <span className="sub">{percent(t.coverage)} do total</span>
            </div>
            <Progress ratio={t.coverage} large color="var(--green)" label={`Reserva cobre ${percent(t.coverage)} do total a pagar`} />
            <div className="summary-strip">
                <span>Saldo em contas <b className="num">{money(cash)}</b></span>
                <span>Reservado <b className="num">{money(reserve)}</b></span>
                <span>Livre <b className={`num ${cash - reserve < 0 ? 'neg' : ''}`}>{money(round2(cash - reserve))}</b></span>
            </div>
            {reserve > cash + 0.004 && (
                <div className="callout danger">A reserva passa do dinheiro que você tem em contas. Confira se algum depósito na reserva ainda não entrou nas contas.</div>
            )}
            {t.surplus > 0 && <div className="callout info">A reserva já cobre todas as contas e sobram {money(t.surplus)}.</div>}
            <div className="row">
                <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => onMove(false)}><Plus size={15} /> Adicionar</button>
                {reserve > 0 && <button className="btn btn-secondary btn-sm" onClick={() => onMove(true)}><Minus size={15} /> Retirar</button>}
                {moves.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setHistory(!history)} aria-expanded={history}>Histórico</button>}
            </div>
            {history && (
                <div className="list">
                    {moves.map((m) => (
                        <div className="list-row" key={m.key}>
                            <span className="list-main"><span className="list-title">{m.label}</span><span className="list-sub">{shortDate(m.date, today)}</span></span>
                            <span className={`list-amount ${m.amount > 0 ? 'pos' : ''}`}>{m.amount > 0 ? '+ ' : '− '}{money(Math.abs(m.amount))}</span>
                            {m.id && (
                                <button
                                    className="btn-icon sm"
                                    onClick={() => remove('reserveMoves', m.id)}
                                    disabled={m.amount > 0 && round2(t.reserve - m.amount) < 0}
                                    title={m.amount > 0 && round2(t.reserve - m.amount) < 0 ? 'Esse dinheiro já foi usado em pagamentos' : undefined}
                                    aria-label="Excluir registro"
                                >×</button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ------------------------------------------------------------
// Lista de contas
// ------------------------------------------------------------

function BillRow({ entry, onOpen }) {
    const { today } = useData();
    const { bill } = entry;
    const cat = BILL_CATEGORIES[bill.category] || BILL_CATEGORIES.other;
    return (
        <button className={`list-row bill-row ${entry.status}${entry.soon ? ' soon' : ''}`} onClick={() => onOpen(entry.id)}>
            <span className="cat-icon sm" style={{ '--c': billColor(entry) }} aria-hidden="true"><Icon name={cat.icon} size={15} /></span>
            <span className="list-main">
                <span className="list-title">{bill.description}</span>
                <span className="list-sub">
                    <span>{cat.label}</span>
                    <span>{shortDate(bill.dueDate, today)}</span>
                    <BillStatusTag status={entry.status} />
                    {entry.status !== 'paid' && <span className={`bill-due${entry.status === 'overdue' ? ' late' : entry.soon ? ' soon' : ''}`}>{dueText(entry)}</span>}
                    {bill.recurrence === 'monthly' && <Repeat size={12} aria-label="Mensal" />}
                </span>
            </span>
            <span className="list-amount">
                {money(entry.status === 'paid' ? entry.amount : entry.remaining)}
                {entry.status !== 'paid' && entry.paid > 0 && <small>de {money(entry.amount)}</small>}
            </span>
        </button>
    );
}

function BillsList({ month, setMonth, onOpen, onNew }) {
    const { billLedger } = useData();
    const [view, setView] = useState('open');
    const [category, setCategory] = useState('');
    const [status, setStatus] = useState('');
    const [due, setDue] = useState('');
    const [order, setOrder] = useState('asc');

    const filtered = useMemo(() => {
        const list = billLedger.bills.filter((e) => {
            if (view === 'open' && e.status === 'paid') return false;
            if (view === 'month' && monthOf(e.bill.dueDate) !== month) return false;
            if (category && (e.bill.category || 'other') !== category) return false;
            if (status && e.status !== status) return false;
            if (due === 'late' && e.status !== 'overdue') return false;
            if ((due === '7' || due === '30') && !(e.daysLeft >= 0 && e.daysLeft <= Number(due))) return false;
            return true;
        });
        return order === 'asc' ? list : [...list].reverse();
    }, [billLedger, view, month, category, status, due, order]);

    // Agrupa por mês de vencimento, com o total que falta em cada mês.
    const groups = useMemo(() => {
        const out = new Map();
        for (const e of filtered) {
            const ym = monthOf(e.bill.dueDate);
            if (!out.has(ym)) out.set(ym, { ym, remaining: 0, items: [] });
            out.get(ym).remaining += e.remaining;
            out.get(ym).items.push(e);
        }
        return [...out.values()];
    }, [filtered]);

    const hasFilters = category || status || due;
    const clear = () => { setCategory(''); setStatus(''); setDue(''); };
    const totalShown = round2(filtered.reduce((acc, e) => acc + e.remaining, 0));

    return (
        <div className="card stack">
            <div className="card-head">
                <h2>Contas e vencimentos</h2>
            </div>
            <div className="toolbar">
                <div className="chips" role="radiogroup" aria-label="Visualizar">
                    {VIEWS.map((v) => (
                        <button key={v.id} role="radio" aria-checked={view === v.id} className={`chip${view === v.id ? ' active' : ''}`} onClick={() => setView(v.id)}>{v.label}</button>
                    ))}
                </div>
                {view === 'month' && <MonthPicker value={month} onChange={setMonth} />}
            </div>
            <div className="toolbar bill-filters">
                <select className="filter-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoria">
                    <option value="">Todas as categorias</option>
                    {Object.entries(BILL_CATEGORIES).map(([id, c]) => <option key={id} value={id}>{c.label}</option>)}
                </select>
                <select className="filter-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                    <option value="">Qualquer status</option>
                    {Object.entries(BILL_STATUS).filter(([id]) => view !== 'open' || id !== 'paid').map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
                <select className="filter-select" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Vencimento">
                    <option value="">Qualquer vencimento</option>
                    <option value="late">Já vencidas</option>
                    <option value="7">Vencem em até 7 dias</option>
                    <option value="30">Vencem em até 30 dias</option>
                </select>
                <select className="filter-select" value={order} onChange={(e) => setOrder(e.target.value)} aria-label="Ordem">
                    <option value="asc">Vencimento mais próximo</option>
                    <option value="desc">Vencimento mais distante</option>
                </select>
                {hasFilters && <button className="btn btn-ghost btn-sm" onClick={clear}><X size={14} /> Limpar</button>}
            </div>
            {filtered.length > 0 && (
                <div className="summary-strip" aria-live="polite">
                    <span>{plural(filtered.length, 'conta', 'contas')}</span>
                    <span>Falta pagar <b className="num">{money(totalShown)}</b></span>
                </div>
            )}

            {groups.length ? groups.map((g) => (
                <div className="day-group" key={g.ym}>
                    <div className="day-head">
                        <span>{monthLabel(g.ym)}</span>
                        <span className="num">{g.remaining > 0.004 ? `falta ${money(g.remaining)}` : 'tudo pago'}</span>
                    </div>
                    <div className="list">
                        {g.items.map((e) => <BillRow key={e.id} entry={e} onOpen={onOpen} />)}
                    </div>
                </div>
            )) : (
                <EmptyState
                    icon={billLedger.bills.length ? 'receipt' : 'calendar'}
                    title={!billLedger.bills.length ? 'Nenhuma conta cadastrada' : view === 'open' && !hasFilters ? 'Nenhuma conta pendente' : 'Nada com esses filtros'}
                    action={!billLedger.bills.length
                        ? <button className="btn btn-primary" onClick={onNew}><Plus size={16} /> Cadastrar conta</button>
                        : hasFilters && <button className="btn btn-secondary" onClick={clear}>Limpar filtros</button>}
                >
                    {!billLedger.bills.length
                        ? 'Boletos, mensalidades, financiamentos e faturas: cadastre e veja quanto precisa juntar até o vencimento.'
                        : view === 'open' && !hasFilters ? 'Tudo em dia por aqui.' : `Tente outro filtro${view === 'month' ? ' ou mês' : ''}.`}
                </EmptyState>
            )}
            {view === 'open' && billLedger.bills.some((e) => e.status === 'paid') && <p className="hint center">Contas pagas aparecem em “Por mês” e “Todas”.</p>}
        </div>
    );
}

// ------------------------------------------------------------
// Página
// ------------------------------------------------------------

export function Bills() {
    const { billLedger, billPayments, today } = useData();
    const [month, setMonth] = useState(monthOf(today));
    const [form, setForm] = useState(null);
    const [detail, setDetail] = useState(null);
    const [reserveForm, setReserveForm] = useState(null);
    const t = billLedger.totals;
    const paid = useMemo(() => billsPaidInMonth(billPayments, month), [billPayments, month]);

    return (
        <div className="page">
            <Topbar eyebrow="Planejamento" title="Contas a pagar">
                <button className="btn btn-primary btn-sm" onClick={() => setForm({})}><Plus size={16} /> Nova conta</button>
            </Topbar>

            <section className="kpis" aria-label="Resumo das contas">
                <Kpi
                    label="Total a pagar"
                    icon={Receipt}
                    value={t.pending}
                    foot={t.openCount
                        ? `${plural(t.openCount, 'conta', 'contas')} em aberto${t.overdueCount ? ` · ${t.overdueCount} vencida${t.overdueCount > 1 ? 's' : ''}` : ''}`
                        : 'nada pendente'}
                />
                <Kpi label="Dinheiro reservado" icon={PiggyBank} value={Math.max(t.reserve, 0)} foot="separado para as contas" />
                <Kpi
                    hero
                    label="Falta juntar"
                    icon={Target}
                    value={t.missing}
                    foot={t.pending > 0 ? (t.missing > 0 ? `a reserva cobre ${percent(t.coverage)}` : 'reserva cobre tudo') : 'tudo em dia'}
                />
                <Kpi label="Total pago" icon={CircleCheck} value={paid} foot={`em ${monthLabel(month)}`} />
            </section>

            {t.overdueCount > 0 && (
                <div className="callout danger">
                    <CalendarClock size={16} />
                    <span><strong>{plural(t.overdueCount, 'conta vencida', 'contas vencidas')}</strong> somando {money(t.overdue)}. Pague ou atualize o vencimento para manter o controle em dia.</span>
                </div>
            )}

            <div className="grid grid-2 bills-layout">
                <BillsList month={month} setMonth={setMonth} onOpen={setDetail} onNew={() => setForm({})} />
                <ReserveCard onMove={(withdraw) => setReserveForm({ withdraw })} />
            </div>

            {form && <BillForm bill={form.id ? form : null} onClose={() => setForm(null)} />}
            {detail && <BillDetail billId={detail} onClose={() => setDetail(null)} onEdit={(bill) => setForm(bill)} />}
            {reserveForm && <ReserveForm {...reserveForm} onClose={() => setReserveForm(null)} />}
        </div>
    );
}
