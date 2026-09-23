import { Info, Pause, Play, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Topbar } from '../components/Topbar.jsx';
import { CategoryIcon, EmptyState, Modal, Progress } from '../components/ui.jsx';
import { materializeRecurrences, saveRecurrence } from '../lib/bootstrap.js';
import { FREQUENCIES, defaultAccountId, installmentGroups, isCredit, nextOccurrence } from '../lib/finance.js';
import { CATEGORY_IDS } from '../lib/defaults.js';
import { money, parseAmount, relativeDay, round2, shortDate } from '../lib/format.js';
import { remove, removeMany, save } from '../lib/store.js';
import { useData, useUI } from '../state.jsx';

const monthlyEquivalent = (r) => (r.frequency === 'weekly' ? (r.amount * 52) / 12 : r.frequency === 'yearly' ? r.amount / 12 : r.amount);

function RecurrenceForm({ rec, onClose }) {
    const { categories, activeAccounts, today, transactions, profile } = useData();
    const ui = useUI();
    const editing = Boolean(rec?.id);
    const [type, setType] = useState(rec?.type || 'expense');
    const [description, setDescription] = useState(rec?.description || '');
    const [amount, setAmount] = useState(rec?.amount ? String(rec.amount).replace('.', ',') : '');
    const [frequency, setFrequency] = useState(rec?.frequency || 'monthly');
    const [day, setDay] = useState(rec?.day || Number(today.slice(8, 10)));
    const [startDate, setStartDate] = useState(rec?.startDate || today);
    const [endDate, setEndDate] = useState(rec?.endDate || '');
    const [categoryId, setCategoryId] = useState(rec?.categoryId || '');
    const [accountId, setAccountId] = useState(rec?.accountId || defaultAccountId({ accounts: activeAccounts, transactions, profile }));
    const [error, setError] = useState('');
    const kindCats = categories.filter((c) => c.kind === type);

    async function submit(e) {
        e.preventDefault();
        const value = parseAmount(amount);
        if (!description.trim()) return setError('Dê um nome à recorrência.');
        if (!(value > 0)) return setError('Informe um valor válido.');
        if (frequency === 'monthly' && !(Number(day) >= 1 && Number(day) <= 31)) return setError('Dia do mês: de 1 a 31.');
        if (endDate && endDate < startDate) return setError('O fim precisa ser depois do início.');
        await saveRecurrence({
            ...rec,
            type,
            description: description.trim(),
            amount: round2(value),
            frequency,
            day: frequency === 'monthly' ? Number(day) : null,
            startDate,
            endDate: endDate || null,
            categoryId: categoryId || (type === 'income' ? CATEGORY_IDS.otherIncome : CATEGORY_IDS.other),
            accountId,
        });
        ui.toast(editing ? 'Recorrência atualizada. Vale para as próximas ocorrências.' : 'Recorrência criada.', 'success');
        onClose();
    }

    async function onDelete() {
        const ok = await ui.confirm({
            title: `Excluir "${rec.description}"?`,
            message: 'Os lançamentos já gerados continuam no extrato; só as próximas ocorrências deixam de ser criadas.',
            confirmLabel: 'Excluir recorrência',
            danger: true,
        });
        if (!ok) return;
        await remove('recurrences', rec.id);
        onClose();
    }

    return (
        <Modal
            title={editing ? 'Editar recorrência' : 'Nova recorrência'}
            onClose={onClose}
            footer={(
                <>
                    {editing && <button type="button" className="btn btn-danger" onClick={onDelete}>Excluir</button>}
                    <button type="submit" form="rec-form" className="btn btn-primary">Salvar</button>
                </>
            )}
        >
            <form id="rec-form" onSubmit={submit} noValidate>
                {rec?.system === 'salary' && (
                    <div className="callout info" style={{ marginBottom: 14 }}><Info size={16} /> Esta é a recorrência do seu salário. O valor e o dia também podem ser alterados em Ajustes.</div>
                )}
                <div className="segmented">
                    <button type="button" className={`${type === 'expense' ? 'active' : ''} expense`} onClick={() => { setType('expense'); setCategoryId(''); }}>Despesa</button>
                    <button type="button" className={`${type === 'income' ? 'active' : ''} income`} onClick={() => { setType('income'); setCategoryId(''); }}>Receita</button>
                </div>
                <div className="field mt">
                    <label className="label" htmlFor="rec-desc">Descrição</label>
                    <input id="rec-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Internet, aluguel, academia…" data-autofocus />
                </div>
                <div className="field-row">
                    <div className="field">
                        <label className="label" htmlFor="rec-amount">Valor</label>
                        <div className="input-affix"><input id="rec-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" /><span className="affix">R$</span></div>
                    </div>
                    <div className="field">
                        <label className="label" htmlFor="rec-freq">Repete</label>
                        <select id="rec-freq" className="select" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                            {Object.entries(FREQUENCIES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                        </select>
                    </div>
                </div>
                <div className="field-row">
                    {frequency === 'monthly' && (
                        <div className="field">
                            <label className="label" htmlFor="rec-day">Todo dia</label>
                            <input id="rec-day" type="number" min={1} max={31} className="input" value={day} onChange={(e) => setDay(e.target.value)} />
                        </div>
                    )}
                    <div className="field">
                        <label className="label" htmlFor="rec-start">{frequency === 'monthly' ? 'A partir de' : 'Primeira data'}</label>
                        <input id="rec-start" type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value || today)} />
                    </div>
                </div>
                <div className="field-row">
                    <div className="field">
                        <label className="label" htmlFor="rec-cat">Categoria</label>
                        <select id="rec-cat" className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                            <option value="">{type === 'income' ? 'Outras receitas' : 'Outros'}</option>
                            {kindCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </div>
                    <div className="field">
                        <label className="label" htmlFor="rec-acc">Conta</label>
                        <select id="rec-acc" className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                            {activeAccounts.filter((a) => type === 'expense' || !isCredit(a)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                    </div>
                </div>
                <div className="field">
                    <label className="label" htmlFor="rec-end">Termina em <span className="muted">(opcional)</span></label>
                    <input id="rec-end" type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
                {error && <div className="callout danger mt" role="alert">{error}</div>}
            </form>
        </Modal>
    );
}

function RecurrencesTab({ openId }) {
    const { recurrences, categoryById, accountById, today } = useData();
    const ui = useUI();
    const [editing, setEditing] = useState(() => (openId ? recurrences.find((r) => r.id === openId) || null : null));

    const list = useMemo(() => recurrences
        .map((r) => ({ ...r, next: nextOccurrence(r, today) }))
        .sort((a, b) => Number(!!a.paused) - Number(!!b.paused) || (a.next || '9').localeCompare(b.next || '9')), [recurrences, today]);

    const active = list.filter((r) => !r.paused && (!r.endDate || r.endDate >= today));
    const fixedOut = active.filter((r) => r.type === 'expense').reduce((a, r) => a + monthlyEquivalent(r), 0);
    const fixedIn = active.filter((r) => r.type === 'income').reduce((a, r) => a + monthlyEquivalent(r), 0);

    async function togglePause(r) {
        await save('recurrences', { ...r, paused: !r.paused });
        if (r.paused) await materializeRecurrences(today);
        ui.toast(r.paused ? 'Recorrência retomada.' : 'Recorrência pausada.', 'info');
    }

    return (
        <>
            <section className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                <div className="card kpi"><span className="kpi-label">Despesas fixas / mês</span><span className="kpi-value num">{money(fixedOut)}</span></div>
                <div className="card kpi"><span className="kpi-label">Receitas fixas / mês</span><span className="kpi-value num pos">{money(fixedIn)}</span></div>
                <div className="card kpi"><span className="kpi-label">Ativas</span><span className="kpi-value num">{active.length}</span></div>
            </section>
            <div className="card">
                <div className="card-head">
                    <h2>Recorrências</h2>
                    <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}><Plus size={15} /> Nova</button>
                </div>
                {list.length ? (
                    <div className="list">
                        {list.map((r) => (
                            <div className="list-row" key={r.id} style={r.paused ? { opacity: 0.6 } : undefined}>
                                <button className="row" style={{ flex: 1, minWidth: 0, textAlign: 'left' }} onClick={() => setEditing(r)}>
                                    <CategoryIcon category={categoryById.get(r.categoryId)} />
                                    <span className="list-main">
                                        <span className="list-title">{r.description}</span>
                                        <span className="list-sub">
                                            {FREQUENCIES[r.frequency]}{r.frequency === 'monthly' && ` · dia ${r.day}`}
                                            {accountById.get(r.accountId) && ` · ${accountById.get(r.accountId).name}`}
                                            {r.paused ? <span className="tag">Pausada</span> : r.next ? <span className="tag blue">Próxima: {relativeDay(r.next, today)}</span> : <span className="tag">Encerrada</span>}
                                        </span>
                                    </span>
                                    <span className={`list-amount ${r.type === 'income' ? 'pos' : ''}`}>{r.type === 'income' ? '+ ' : ''}{money(r.amount)}</span>
                                </button>
                                <button className="btn-icon sm" onClick={() => togglePause(r)} aria-label={r.paused ? 'Retomar' : 'Pausar'} title={r.paused ? 'Retomar' : 'Pausar'}>
                                    {r.paused ? <Play size={16} /> : <Pause size={16} />}
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <EmptyState icon="repeat" title="Nenhuma conta fixa" action={<button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} /> Cadastrar recorrência</button>}>
                        Cadastre uma vez — internet, aluguel, assinaturas — e o Caderneta lança sozinho todo mês.
                    </EmptyState>
                )}
            </div>
            {editing && <RecurrenceForm rec={editing.id ? editing : null} onClose={() => setEditing(null)} />}
        </>
    );
}

function InstallmentsTab() {
    const { transactions, today, accountById, categoryById } = useData();
    const ui = useUI();
    const groups = useMemo(() => installmentGroups(transactions, today), [transactions, today]);
    const open = groups.filter((g) => !g.done);
    const done = groups.filter((g) => g.done);
    const remaining = open.reduce((a, g) => a + g.remainingAmount, 0);
    const nextMonth = open.reduce((a, g) => a + (g.nextDate ? g.items.find((t) => t.date === g.nextDate).amount : 0), 0);

    async function cancelRest(g) {
        const future = g.items.filter((t) => t.date > today);
        const ok = await ui.confirm({
            title: `Encerrar "${g.description}"?`,
            message: `Remove as ${future.length} parcelas futuras (${money(g.remainingAmount)}). Use quando quitar antecipado ou cancelar a compra.`,
            confirmLabel: 'Remover parcelas futuras',
            danger: true,
        });
        if (!ok) return;
        await removeMany('transactions', future.map((t) => t.id));
        ui.toast('Parcelas futuras removidas.', 'info');
    }

    const Row = ({ g }) => (
        <div className="budget-row">
            <div className="budget-top">
                <CategoryIcon category={categoryById.get(g.categoryId)} />
                <span className="list-main">
                    <span className="list-title">{g.description}</span>
                    <span className="list-sub">{g.count}x de {money(g.installmentAmount)} · {accountById.get(g.accountId)?.name || '—'}</span>
                </span>
                <span className="list-amount">{money(g.totalAmount)}<small>{g.paidCount}/{g.count} pagas</small></span>
            </div>
            <Progress ratio={g.paidCount / g.count} color="var(--series-1)" label={`${g.paidCount} de ${g.count} parcelas`} />
            <div className="budget-meta">
                <span>{g.done ? 'Quitado' : `Próxima: ${shortDate(g.nextDate, today)}`}</span>
                {!g.done && <span>Falta {money(g.remainingAmount)} · <button className="table-toggle" onClick={() => cancelRest(g)}>encerrar</button></span>}
            </div>
        </div>
    );

    return (
        <>
            <section className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                <div className="card kpi"><span className="kpi-label">Falta pagar</span><span className="kpi-value num">{money(remaining)}</span></div>
                <div className="card kpi"><span className="kpi-label">Próximas parcelas</span><span className="kpi-value num">{money(nextMonth)}</span></div>
                <div className="card kpi"><span className="kpi-label">Em andamento</span><span className="kpi-value num">{open.length}</span></div>
            </section>
            <div className="card">
                <div className="card-head">
                    <h2>Compras parceladas</h2>
                    <button className="btn btn-primary btn-sm" onClick={() => ui.openTx({ type: 'expense' })}><Plus size={15} /> Nova compra</button>
                </div>
                {open.length ? open.map((g) => <Row key={g.groupId} g={g} />) : (
                    <EmptyState icon="layers" title="Nenhum parcelamento em andamento">
                        Ao lançar uma despesa, escolha "Parcelada": Notebook • R$ 3.600 • 12x de R$ 300 — e o Caderneta cria e acompanha as 12 parcelas.
                    </EmptyState>
                )}
            </div>
            {done.length > 0 && (
                <details className="card">
                    <summary className="label" style={{ cursor: 'pointer' }}>Quitados ({done.length})</summary>
                    {done.map((g) => <Row key={g.groupId} g={g} />)}
                </details>
            )}
        </>
    );
}

export function Recurring({ params }) {
    const [tab, setTab] = useState(params.aba === 'parcelas' ? 'installments' : 'recurring');
    return (
        <div className="page">
            <Topbar eyebrow="Contas fixas e parcelamentos" title="Recorrentes e parcelas" />
            <div className="tabs" role="tablist">
                <button role="tab" aria-selected={tab === 'recurring'} className={tab === 'recurring' ? 'active' : ''} onClick={() => setTab('recurring')}>Recorrências</button>
                <button role="tab" aria-selected={tab === 'installments'} className={tab === 'installments' ? 'active' : ''} onClick={() => setTab('installments')}>Parcelamentos</button>
            </div>
            {tab === 'recurring' ? <RecurrencesTab openId={params.id} /> : <InstallmentsTab />}
        </div>
    );
}
