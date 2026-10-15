import { Info, Plus, Target, Wallet, Scale } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Topbar } from '../components/Topbar.jsx';
import { PlanItemForm, planItemError } from '../components/BillForms.jsx';
import { AnimatedMoney, EmptyState } from '../components/ui.jsx';
import { saveBill } from '../lib/bills.js';
import { monthLabel } from '../lib/dates.js';
import { availableAfterPlan, cashBalance } from '../lib/finance.js';
import { money, parseAmount } from '../lib/format.js';
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

const dayMonth = (iso) => iso.split('-').reverse().slice(0, 2).join('/');

/** Linha de adição rápida, como numa planilha: descrição, vencimento e valor. */
function QuickAdd() {
    const ui = useUI();
    const { today } = useData();
    const [description, setDescription] = useState('');
    const [dueDate, setDueDate] = useState(today);
    const [amount, setAmount] = useState('');

    async function submit(e) {
        e.preventDefault();
        const value = parseAmount(amount);
        const problem = planItemError({ description, amount: value, dueDate });
        if (problem) return ui.toast(problem, 'error');
        await saveBill({ description, amount: value, dueDate });
        ui.toast(`${money(value)} adicionados ao planejamento.`, 'success');
        setDescription('');
        setAmount('');
    }

    return (
        <form className="plan-add" onSubmit={submit} noValidate>
            <input className="input plan-add-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Conta (ex.: Católica)" maxLength={60} aria-label="Descrição" />
            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Vencimento" />
            <div className="input-affix">
                <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0,00" autoComplete="off" aria-label="Valor" />
                <span className="affix">R$</span>
            </div>
            <button type="submit" className="btn btn-primary"><Plus size={16} /> Adicionar</button>
        </form>
    );
}

export function Bills() {
    const { plan, accounts, transactions, today } = useData();
    const [form, setForm] = useState(null);
    const balance = useMemo(() => cashBalance(accounts, transactions, today), [accounts, transactions, today]);
    const available = availableAfterPlan(balance, plan.total);

    return (
        <div className="page">
            <Topbar eyebrow="Quanto preciso juntar" title="Planejamento">
                <button className="btn btn-primary btn-sm" onClick={() => setForm({})}><Plus size={16} /> Novo item</button>
            </Topbar>

            <section className="kpis kpis-3" aria-label="Resumo do planejamento">
                <Kpi hero label="Total necessário" icon={Target} value={plan.total} foot={`${plan.count} ${plan.count === 1 ? 'conta planejada' : 'contas planejadas'}`} />
                <Kpi label="Saldo atual" icon={Wallet} value={balance} foot="dinheiro registrado" />
                <Kpi label="Disponível após planejamento" icon={Scale} value={available} foot={available < 0 ? 'falta juntar' : 'saldo − planejado'} />
            </section>

            <div className="card stack">
                <div className="card-head"><h2>Adicionar conta</h2></div>
                <QuickAdd />
                <div className="callout info">
                    <Info size={16} />
                    <span>O planejamento não mexe no saldo nem nas despesas. Quando pagar um boleto, lance a despesa em Movimentações e, se quiser, exclua o item daqui.</span>
                </div>
            </div>

            {plan.months.length ? plan.months.map((m) => (
                <section className="card" key={m.ym} aria-label={`Planejamento de ${monthLabel(m.ym)}`}>
                    <div className="card-head"><h2>Planejamento de {monthLabel(m.ym).toLowerCase().replace(' ', ' de ')}</h2></div>
                    <div className="plan-table">
                        <div className="plan-row plan-head" aria-hidden="true">
                            <span>Conta</span>
                            <span>Vencimento</span>
                            <span className="r">Valor</span>
                        </div>
                        {m.items.map((b) => (
                            <button className="plan-row" key={b.id} onClick={() => setForm(b)} aria-label={`${b.description}, vence ${dayMonth(b.dueDate)}, ${money(b.amount)}. Editar`}>
                                <span className="plan-desc">{b.description}</span>
                                <span className={`num${b.dueDate < today ? ' muted' : ''}`}>{dayMonth(b.dueDate)}</span>
                                <span className="num r">{money(b.amount)}</span>
                            </button>
                        ))}
                        <div className="plan-row plan-total">
                            <span>Total necessário</span>
                            <span />
                            <span className="num r">{money(m.total)}</span>
                        </div>
                    </div>
                </section>
            )) : (
                <div className="card">
                    <EmptyState icon="target" title="Nenhuma conta planejada">
                        Adicione as contas dos próximos vencimentos para ver quanto precisa juntar.
                    </EmptyState>
                </div>
            )}

            {form && <PlanItemForm bill={form.id ? form : null} onClose={() => setForm(null)} />}
        </div>
    );
}
