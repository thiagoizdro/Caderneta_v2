import { Briefcase, HandCoins, Info, Landmark, Plus, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Topbar } from '../components/Topbar.jsx';
import { WorkdayStatusTag } from '../components/PaymentForm.jsx';
import { AnimatedMoney, EmptyState } from '../components/ui.jsx';
import { monthLabel, monthOf, startOfMonth } from '../lib/dates.js';
import { PAYMENT_METHODS, PROFILE_ID, RECEIVABLE_ID } from '../lib/defaults.js';
import { cashBalance } from '../lib/finance.js';
import { money, round2, shortDate } from '../lib/format.js';
import { saveMany, update } from '../lib/store.js';
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

/**
 * Diárias de antes deste controle entraram direto no saldo da conta e contam
 * como pagas. Aqui o usuário confirma isso ou move as ainda não pagas para "a receber".
 */
function LegacyReview({ direct }) {
    const { today, accountById } = useData();
    const ui = useUI();
    const [moving, setMoving] = useState(false);
    const [from, setFrom] = useState(() => {
        const start = startOfMonth(monthOf(today));
        return direct.some((d) => d.date >= start) ? start : direct[direct.length - 1].date;
    });
    const total = round2(direct.reduce((acc, d) => acc + d.amount, 0));
    const toMove = direct.filter((d) => d.date >= from);
    const moveTotal = round2(toMove.reduce((acc, d) => acc + d.amount, 0));

    const markReviewed = () => update('settings', PROFILE_ID, { workdaysReviewed: true });

    async function move() {
        if (!toMove.length) return ui.toast('Nenhuma diária a partir dessa data.', 'warn');
        const names = [...new Set(toMove.map((d) => accountById.get(d.tx.accountId)?.name).filter(Boolean))].join(', ');
        const ok = await ui.confirm({
            title: `Mover ${plural(toMove.length, 'diária', 'diárias')} para "a receber"?`,
            message: `${money(moveTotal)} saem do saldo de ${names || 'suas contas'} e passam a aparecer como saldo a receber da empresa, até você registrar o pagamento.`,
            confirmLabel: 'Mover',
        });
        if (!ok) return;
        await saveMany('transactions', toMove.map((d) => ({ ...d.tx, accountId: RECEIVABLE_ID })));
        await markReviewed();
        ui.toast(`${plural(toMove.length, 'diária movida', 'diárias movidas')} para a receber (${money(moveTotal)}).`, 'success');
    }

    return (
        <div className="card">
            <div className="callout info">
                <Info size={16} />
                <span>
                    <strong>{plural(direct.length, 'diária registrada', 'diárias registradas')} antes deste controle ({money(total)})</strong> entraram direto no saldo da conta e aparecem como <b>pagas</b>.
                    {' '}Se a empresa ainda não pagou alguma delas, mova-as para o saldo a receber.
                </span>
            </div>
            {moving ? (
                <div className="row wrap mt" style={{ alignItems: 'flex-end' }}>
                    <div className="field" style={{ flex: '1 1 180px' }}>
                        <label className="label" htmlFor="legacy-from">Ainda não recebi as diárias a partir de</label>
                        <input id="legacy-from" type="date" className="input" value={from} max={today} onChange={(e) => setFrom(e.target.value || from)} />
                        <span className="hint">{plural(toMove.length, 'diária', 'diárias')} · {money(moveTotal)}</span>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={move} disabled={!toMove.length}>Mover para a receber</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setMoving(false)}>Cancelar</button>
                </div>
            ) : (
                <div className="row wrap mt">
                    <button className="btn btn-secondary btn-sm" onClick={() => setMoving(true)}>Algumas ainda não foram pagas</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => markReviewed().then(() => ui.toast('Certo — as diárias anteriores ficam como pagas.', 'success'))}>Já recebi todas</button>
                </div>
            )}
        </div>
    );
}

const FILTERS = [
    { id: 'open', label: 'A receber' },
    { id: 'paid', label: 'Pagas' },
    { id: 'all', label: 'Todas' },
];

function WorkdaysCard({ ledger }) {
    const { today } = useData();
    const ui = useUI();
    const [filter, setFilter] = useState(ledger.totals.pendingCount ? 'open' : 'all');

    const groups = useMemo(() => {
        const out = new Map();
        for (const d of [...ledger.days].reverse()) {
            const ym = monthOf(d.date);
            if (!out.has(ym)) out.set(ym, { ym, worked: 0, paid: 0, items: [] });
            const g = out.get(ym);
            g.worked += d.amount;
            g.paid += d.paid;
            const show = filter === 'all' || (filter === 'paid' ? d.status === 'paid' : d.status !== 'paid');
            if (show) g.items.push(d);
        }
        return [...out.values()].filter((g) => g.items.length);
    }, [ledger, filter]);

    return (
        <div className="card">
            <div className="card-head">
                <h2>Diárias trabalhadas</h2>
                <a className="card-link" href="#/calendario">Calendário</a>
            </div>
            <div className="chips" role="radiogroup" aria-label="Situação" style={{ marginBottom: 10 }}>
                {FILTERS.map((f) => (
                    <button key={f.id} role="radio" aria-checked={filter === f.id} className={`chip${filter === f.id ? ' active' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
                ))}
            </div>
            {groups.length ? groups.map((g) => (
                <div className="day-group" key={g.ym}>
                    <div className="day-head">
                        <span>{monthLabel(g.ym)}</span>
                        <span className="num">
                            {money(g.worked)}{g.worked - g.paid > 0.004 ? ` · falta ${money(g.worked - g.paid)}` : ' · pago'}
                        </span>
                    </div>
                    <div className="list">
                        {g.items.map((d) => (
                            <button className="list-row" key={d.id} onClick={() => ui.openTx(d.tx)}>
                                <span className="cat-icon sm" style={{ '--c': d.status === 'paid' ? 'var(--green)' : d.status === 'partial' ? 'var(--blue)' : 'var(--gold)' }} aria-hidden="true">
                                    <Briefcase size={15} />
                                </span>
                                <span className="list-main">
                                    <span className="list-title">{shortDate(d.date, today)}</span>
                                    <span className="list-sub">
                                        <WorkdayStatusTag status={d.status} />
                                        {d.direct && <span>direto na conta</span>}
                                        {d.status === 'partial' && <span>recebido {money(d.paid)}</span>}
                                    </span>
                                </span>
                                <span className="list-amount">
                                    {money(d.amount)}
                                    {d.status !== 'paid' && <small>falta {money(d.remaining)}</small>}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )) : (
                <EmptyState icon="briefcase" title={ledger.days.length ? 'Nada nesta situação' : 'Nenhuma diária marcada'}>
                    {ledger.days.length ? 'Troque o filtro para ver as outras diárias.' : 'Marque os dias trabalhados no calendário.'}
                </EmptyState>
            )}
        </div>
    );
}

function PaymentsCard({ ledger, onNew }) {
    const { today, accountById } = useData();
    const ui = useUI();
    const list = [...ledger.payments].reverse();

    return (
        <div className="card">
            <div className="card-head">
                <h2>Pagamentos recebidos</h2>
                <span className="sub">{money(ledger.totals.paidOut)}</span>
            </div>
            {list.length ? (
                <div className="list">
                    {list.map(({ tx, allocations }) => {
                        const covered = allocations.map((a) => {
                            const entry = ledger.byId.get(a.id);
                            const partial = entry && Math.abs(a.amount - entry.amount) > 0.004;
                            return `${shortDate(a.date, today)}${partial ? ' (parcial)' : ''}`;
                        });
                        return (
                            <button className="list-row" key={tx.id} onClick={() => ui.openTx(tx)}>
                                <span className="cat-icon sm" style={{ '--c': 'var(--green)' }} aria-hidden="true"><HandCoins size={15} /></span>
                                <span className="list-main">
                                    <span className="list-title">{shortDate(tx.date, today)} · {PAYMENT_METHODS[tx.method] || 'Pagamento'}</span>
                                    <span className="list-sub">
                                        {accountById.get(tx.toAccountId) && <span>→ {accountById.get(tx.toAccountId).name}</span>}
                                        {tx.notes && <span>“{tx.notes}”</span>}
                                        {tx.date > today && <span className="tag">Agendado</span>}
                                    </span>
                                    {covered.length > 0 && (
                                        <span className="list-sub" style={{ marginTop: 2 }}>
                                            Cobre {covered.length <= 4 ? covered.join(', ') : `${covered.length} diárias (${covered[0]} a ${covered[covered.length - 1]})`}
                                        </span>
                                    )}
                                </span>
                                <span className="list-amount pos">+ {money(tx.amount)}</span>
                            </button>
                        );
                    })}
                </div>
            ) : (
                <EmptyState
                    icon="coins"
                    title="Nenhum pagamento registrado"
                    action={ledger.totals.pending > 0 && <button className="btn btn-primary" onClick={onNew}><Plus size={16} /> Registrar pagamento</button>}
                >
                    Quando a empresa pagar, registre aqui. O saldo a receber cai na hora.
                </EmptyState>
            )}
        </div>
    );
}

export function Diarias() {
    const { workLedger: ledger, profile, accounts, transactions, today } = useData();
    const ui = useUI();
    const t = ledger.totals;
    const cash = useMemo(() => cashBalance(accounts, transactions, today), [accounts, transactions, today]);
    const direct = ledger.days.filter((d) => d.direct);
    const openPayment = () => ui.openPayment();

    if (!ledger.days.length && !ledger.payments.length && profile.mode !== 'daily') {
        return (
            <div className="page">
                <Topbar eyebrow="Modo Diária" title="Diárias e pagamentos" />
                <div className="card">
                    <EmptyState icon="briefcase" title="Disponível no modo Diária" action={<a className="btn btn-primary" href="#/ajustes?secao=modo">Ir para Ajustes</a>}>
                        Controle quanto você trabalhou, quanto a empresa já pagou e quanto ainda falta receber.
                    </EmptyState>
                </div>
            </div>
        );
    }

    return (
        <div className="page">
            <Topbar eyebrow="Modo Diária" title="Diárias e pagamentos">
                <button className="btn btn-primary btn-sm" onClick={openPayment} disabled={t.pending <= 0} title={t.pending <= 0 ? 'Não há saldo a receber' : undefined}>
                    <Plus size={16} /> Registrar pagamento
                </button>
            </Topbar>

            <section className="kpis" aria-label="Resumo das diárias">
                <Kpi label="Total de diárias trabalhadas" icon={Briefcase} value={t.worked} foot={plural(t.count, 'diária', 'diárias')} />
                <Kpi label="Dinheiro já recebido" icon={HandCoins} value={t.received} foot={plural(ledger.payments.length, 'pagamento', 'pagamentos') + (t.direct > 0 ? ` + ${money(t.direct)} direto na conta` : '')} />
                <Kpi hero label="Saldo a receber" icon={Landmark} value={t.pending} foot={t.pendingCount ? `${plural(t.pendingCount, 'diária', 'diárias')} em aberto` : 'tudo recebido'} />
                <Kpi label="Dinheiro em contas" icon={Wallet} value={cash} foot="não inclui o que falta receber" />
            </section>

            {t.credit > 0 && (
                <div className="callout">
                    <Info size={16} />
                    <span>Os pagamentos passam {money(t.credit)} do total das diárias — provavelmente uma diária paga foi excluída ou alterada. Esse valor fica como crédito com a empresa.</span>
                </div>
            )}

            {direct.length > 0 && !profile.workdaysReviewed && <LegacyReview direct={direct} />}

            <div className="grid grid-2">
                <WorkdaysCard ledger={ledger} />
                <PaymentsCard ledger={ledger} onNew={openPayment} />
            </div>
        </div>
    );
}
