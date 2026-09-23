import { Minus, Pencil, Plus, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Topbar } from '../components/Topbar.jsx';
import { Icon, PICKABLE_ICONS, seriesColor } from '../components/Icon.jsx';
import { EmptyState, Modal, Progress } from '../components/ui.jsx';
import { monthLabel, monthOf } from '../lib/dates.js';
import { goalProgress } from '../lib/finance.js';
import { money, parseAmount, percent, round2, shortDate } from '../lib/format.js';
import { remove, removeMany, save } from '../lib/store.js';
import { useData, useUI } from '../state.jsx';

const GOAL_ICONS = ['target', 'laptop', 'plane', 'car', 'home', 'education', 'gift', 'heart', 'piggy', 'smartphone', 'gamepad', 'baby'];

/** A barrinha "██████░░░░" do caderno, com leitura acessível. */
function TextBar({ ratio, color }) {
    const total = 16;
    const filled = Math.round(Math.min(1, ratio) * total);
    return (
        <div className="goal-bar" style={{ '--c': color }} aria-hidden="true">
            {'█'.repeat(filled)}<span style={{ opacity: 0.25 }}>{'░'.repeat(total - filled)}</span>
        </div>
    );
}

function GoalForm({ goal, onClose }) {
    const ui = useUI();
    const { goalDeposits, today } = useData();
    const editing = Boolean(goal?.id);
    const [name, setName] = useState(goal?.name || '');
    const [target, setTarget] = useState(goal?.target ? String(goal.target).replace('.', ',') : '');
    const [initial, setInitial] = useState('');
    const [deadline, setDeadline] = useState(goal?.deadline || '');
    const [icon, setIcon] = useState(goal?.icon || 'target');
    const [color, setColor] = useState(goal?.color || 3);
    const [error, setError] = useState('');

    async function submit(e) {
        e.preventDefault();
        const value = parseAmount(target);
        if (!name.trim()) return setError('Dê um nome à meta.');
        if (!(value > 0)) return setError('Informe quanto você quer juntar.');
        const saved = await save('goals', { ...goal, name: name.trim(), target: round2(value), deadline: deadline || null, icon, color });
        const start = parseAmount(initial);
        if (!editing && start > 0) {
            await save('goalDeposits', { goalId: saved.id, amount: round2(start), date: today, note: 'Valor inicial' });
        }
        ui.toast(editing ? 'Meta atualizada.' : 'Meta criada. Bora juntar!', 'success');
        onClose();
    }

    async function onDelete() {
        if (!(await ui.confirm({ title: `Excluir a meta "${goal.name}"?`, message: 'O histórico de depósitos também será apagado.', confirmLabel: 'Excluir', danger: true }))) return;
        await removeMany('goalDeposits', goalDeposits.filter((d) => d.goalId === goal.id).map((d) => d.id));
        await remove('goals', goal.id);
        onClose();
    }

    return (
        <Modal
            title={editing ? 'Editar meta' : 'Nova meta'}
            onClose={onClose}
            footer={(
                <>
                    {editing && <button type="button" className="btn btn-danger" onClick={onDelete}>Excluir</button>}
                    <button type="submit" form="goal-form" className="btn btn-primary">Salvar</button>
                </>
            )}
        >
            <form id="goal-form" onSubmit={submit} noValidate>
                <div className="field">
                    <label className="label" htmlFor="goal-name">Objetivo</label>
                    <input id="goal-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: PC novo, viagem, reserva de emergência" maxLength={40} data-autofocus />
                </div>
                <div className="field-row">
                    <div className="field">
                        <label className="label" htmlFor="goal-target">Valor da meta</label>
                        <div className="input-affix"><input id="goal-target" className="input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0,00" /><span className="affix">R$</span></div>
                    </div>
                    <div className="field">
                        <label className="label" htmlFor="goal-deadline">Prazo <span className="muted">(opcional)</span></label>
                        <input id="goal-deadline" type="date" className="input" value={deadline} min={today} onChange={(e) => setDeadline(e.target.value)} />
                    </div>
                </div>
                {!editing && (
                    <div className="field">
                        <label className="label" htmlFor="goal-initial">Já tenho guardado <span className="muted">(opcional)</span></label>
                        <div className="input-affix"><input id="goal-initial" className="input" inputMode="decimal" value={initial} onChange={(e) => setInitial(e.target.value)} placeholder="0,00" /><span className="affix">R$</span></div>
                    </div>
                )}
                <div className="field">
                    <span className="label">Ícone e cor</span>
                    <div className="icon-options">
                        {GOAL_ICONS.filter((k) => PICKABLE_ICONS[k]).map((k) => (
                            <button type="button" key={k} className={icon === k ? 'active' : ''} onClick={() => setIcon(k)} aria-label={k}><Icon name={k} size={17} /></button>
                        ))}
                    </div>
                    <div className="color-options" style={{ marginTop: 8 }}>
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => <button type="button" key={c} style={{ '--c': seriesColor(c) }} className={color === c ? 'active' : ''} onClick={() => setColor(c)} aria-label={`Cor ${c}`} />)}
                    </div>
                </div>
                {error && <div className="callout danger mt" role="alert">{error}</div>}
            </form>
        </Modal>
    );
}

function DepositForm({ goal, withdraw, saved, onClose }) {
    const ui = useUI();
    const { today } = useData();
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(today);
    const [note, setNote] = useState('');
    const [error, setError] = useState('');

    async function submit(e) {
        e.preventDefault();
        const value = parseAmount(amount);
        if (!(value > 0)) return setError('Informe um valor.');
        if (withdraw && value > saved) return setError(`Você tem ${money(saved)} guardados nesta meta.`);
        await save('goalDeposits', { goalId: goal.id, amount: round2(withdraw ? -value : value), date, note: note.trim() });
        ui.toast(withdraw ? 'Retirada registrada.' : `+ ${money(value)} em "${goal.name}"`, 'success');
        onClose();
    }

    return (
        <Modal title={withdraw ? `Retirar de "${goal.name}"` : `Depositar em "${goal.name}"`} onClose={onClose}
            footer={<button type="submit" form="dep-form" className="btn btn-primary">{withdraw ? 'Registrar retirada' : 'Guardar'}</button>}>
            <form id="dep-form" onSubmit={submit} noValidate>
                <div className="field">
                    <label className="label" htmlFor="dep-amount">Valor</label>
                    <div className="input-affix lg"><input id="dep-amount" className="input input-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" data-autofocus /><span className="affix">R$</span></div>
                </div>
                <div className="field-row">
                    <div className="field">
                        <label className="label" htmlFor="dep-date">Data</label>
                        <input id="dep-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value || today)} />
                    </div>
                    <div className="field">
                        <label className="label" htmlFor="dep-note">Nota</label>
                        <input id="dep-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={60} />
                    </div>
                </div>
                {error && <div className="callout danger mt" role="alert">{error}</div>}
            </form>
        </Modal>
    );
}

function GoalCard({ goal, onEdit, onDeposit, onWithdraw }) {
    const { goalDeposits, today } = useData();
    const p = useMemo(() => goalProgress(goal, goalDeposits, today), [goal, goalDeposits, today]);
    const color = seriesColor(goal.color);
    const [history, setHistory] = useState(false);

    return (
        <div className="card goal-card">
            <div className="row">
                <span className="cat-icon lg" style={{ '--c': color }}><Icon name={goal.icon} size={22} /></span>
                <div className="list-main">
                    <div className="list-title" style={{ fontSize: 16 }}>{goal.name}</div>
                    <div className="list-sub">{goal.deadline ? `Prazo: ${shortDate(goal.deadline, today)}` : 'Sem prazo'}</div>
                </div>
                <button className="btn-icon sm" onClick={onEdit} aria-label={`Editar ${goal.name}`}><Pencil size={16} /></button>
            </div>
            <div className="goal-amounts">
                <span><strong>{money(p.saved)}</strong> <span className="muted">/ {money(p.target)}</span></span>
                <span className={`delta ${p.done ? 'good' : 'flat'}`}>{percent(p.ratio)}</span>
            </div>
            <TextBar ratio={p.ratio} color={color} />
            <Progress ratio={p.ratio} color={color} label={`${goal.name}: ${percent(p.ratio)}`} />
            {p.done ? (
                <div className="callout info"><Trophy size={16} /> Meta atingida! Parabéns pela disciplina.</div>
            ) : (
                <div className="stack small soft" style={{ gap: 4 }}>
                    <span>Faltam <b className="num">{money(p.remaining)}</b></span>
                    {p.eta && <span>No ritmo atual ({money(p.monthlyAvg)}/mês), você chega lá em <b>{monthLabel(monthOf(p.eta))}</b>.</span>}
                    {p.neededPerMonth && <span>Para cumprir o prazo: <b className="num">{money(p.neededPerMonth)}</b> por mês.</span>}
                    {!p.eta && !p.neededPerMonth && <span>Faça depósitos para ver a previsão de conclusão.</span>}
                </div>
            )}
            <div className="row">
                <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={onDeposit}><Plus size={15} /> Depositar</button>
                {p.saved > 0 && <button className="btn btn-secondary btn-sm" onClick={onWithdraw}><Minus size={15} /> Retirar</button>}
                {p.deposits.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setHistory(!history)} aria-expanded={history}>Histórico</button>}
            </div>
            {history && (
                <div className="list">
                    {[...p.deposits].reverse().map((d) => (
                        <div className="list-row" key={d.id}>
                            <span className="list-main"><span className="list-title">{d.note || (d.amount < 0 ? 'Retirada' : 'Depósito')}</span><span className="list-sub">{shortDate(d.date, today)}</span></span>
                            <span className={`list-amount ${d.amount > 0 ? 'pos' : 'neg'}`}>{d.amount > 0 ? '+ ' : '− '}{money(Math.abs(d.amount))}</span>
                            <button className="btn-icon sm" onClick={() => remove('goalDeposits', d.id)} aria-label="Excluir registro">×</button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export function Goals() {
    const { goals, goalDeposits, today } = useData();
    const [editing, setEditing] = useState(null);
    const [deposit, setDeposit] = useState(null);
    const totals = useMemo(() => goals.reduce((acc, g) => {
        const p = goalProgress(g, goalDeposits, today);
        return { saved: acc.saved + p.saved, target: acc.target + p.target };
    }, { saved: 0, target: 0 }), [goals, goalDeposits, today]);

    return (
        <div className="page">
            <Topbar eyebrow="Objetivos" title="Metas financeiras">
                <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}><Plus size={16} /> Nova meta</button>
            </Topbar>

            {goals.length > 0 && (
                <section className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                    <div className="card kpi hero"><span className="kpi-label">Guardado em metas</span><span className="kpi-value num">{money(totals.saved)}</span></div>
                    <div className="card kpi"><span className="kpi-label">Soma dos objetivos</span><span className="kpi-value num">{money(totals.target)}</span></div>
                    <div className="card kpi"><span className="kpi-label">Progresso geral</span><span className="kpi-value num">{percent(totals.target ? totals.saved / totals.target : 0)}</span></div>
                </section>
            )}

            {goals.length ? (
                <div className="grid grid-2">
                    {goals.map((g) => (
                        <GoalCard
                            key={g.id}
                            goal={g}
                            onEdit={() => setEditing(g)}
                            onDeposit={() => setDeposit({ goal: g })}
                            onWithdraw={() => setDeposit({ goal: g, withdraw: true, saved: goalProgress(g, goalDeposits, today).saved })}
                        />
                    ))}
                </div>
            ) : (
                <div className="card">
                    <EmptyState icon="target" title="Qual é o seu próximo objetivo?" action={<button className="btn btn-primary" onClick={() => setEditing({})}><Plus size={16} /> Criar meta</button>}>
                        PC novo, viagem, reserva de emergência… Registre depósitos e o Caderneta mostra quanto falta e quando você chega lá.
                    </EmptyState>
                </div>
            )}

            {editing && <GoalForm goal={editing.id ? editing : null} onClose={() => setEditing(null)} />}
            {deposit && <DepositForm {...deposit} onClose={() => setDeposit(null)} />}
        </div>
    );
}
