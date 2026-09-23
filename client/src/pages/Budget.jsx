import { Plus, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Topbar } from '../components/Topbar.jsx';
import { Icon, PICKABLE_ICONS, seriesColor } from '../components/Icon.jsx';
import { CategoryIcon, EmptyState, Modal, MonthPicker, Progress } from '../components/ui.jsx';
import { daysInMonth, monthOf, splitMonth } from '../lib/dates.js';
import { budgetLevel, expensesByCategory } from '../lib/finance.js';
import { money, parseAmount, percent, round2 } from '../lib/format.js';
import { save } from '../lib/store.js';
import { navigate, useData, useUI } from '../state.jsx';

export function CategoryForm({ category, onClose }) {
    const ui = useUI();
    const { transactions } = useData();
    const editing = Boolean(category?.id);
    const [name, setName] = useState(category?.name || '');
    const [kind, setKind] = useState(category?.kind || 'expense');
    const [icon, setIcon] = useState(category?.icon || 'tag');
    const [color, setColor] = useState(category?.color || 1);
    const [budget, setBudget] = useState(category?.budget ? String(category.budget).replace('.', ',') : '');
    const [error, setError] = useState('');

    async function submit(e) {
        e.preventDefault();
        if (!name.trim()) return setError('Dê um nome à categoria.');
        const value = budget ? parseAmount(budget) : 0;
        if (Number.isNaN(value) || value < 0) return setError('Limite inválido.');
        await save('categories', { ...category, name: name.trim(), kind, icon, color, budget: kind === 'expense' ? round2(value) : 0 });
        ui.toast(editing ? 'Categoria atualizada.' : 'Categoria criada.', 'success');
        onClose();
    }

    async function onArchive() {
        const used = transactions.filter((t) => t.categoryId === category.id).length;
        const ok = await ui.confirm({
            title: `Arquivar "${category.name}"?`,
            message: used ? `Os ${used} lançamentos continuam com essa categoria nos relatórios; ela só deixa de aparecer para novos lançamentos.` : 'Ela deixa de aparecer para novos lançamentos.',
            confirmLabel: 'Arquivar',
        });
        if (!ok) return;
        await save('categories', { ...category, archived: true });
        onClose();
    }

    return (
        <Modal
            title={editing ? 'Editar categoria' : 'Nova categoria'}
            onClose={onClose}
            footer={(
                <>
                    {editing && <button type="button" className="btn btn-secondary" onClick={onArchive}>Arquivar</button>}
                    <button type="submit" form="cat-form" className="btn btn-primary">Salvar</button>
                </>
            )}
        >
            <form id="cat-form" onSubmit={submit} noValidate>
                {!editing && (
                    <div className="segmented" style={{ marginBottom: 14 }}>
                        <button type="button" className={`${kind === 'expense' ? 'active' : ''} expense`} onClick={() => setKind('expense')}>Despesa</button>
                        <button type="button" className={`${kind === 'income' ? 'active' : ''} income`} onClick={() => setKind('income')}>Receita</button>
                    </div>
                )}
                <div className="row">
                    <CategoryIcon category={{ icon, color }} size="lg" />
                    <div className="field" style={{ flex: 1 }}>
                        <label className="label" htmlFor="cat-name">Nome</label>
                        <input id="cat-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} data-autofocus />
                    </div>
                </div>
                {kind === 'expense' && (
                    <div className="field">
                        <label className="label" htmlFor="cat-budget">Limite mensal <span className="muted">(opcional)</span></label>
                        <div className="input-affix"><input id="cat-budget" className="input" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Sem limite" /><span className="affix">R$</span></div>
                        <span className="hint">Você recebe um aviso ao chegar em 80% e ao ultrapassar o limite.</span>
                    </div>
                )}
                <div className="field">
                    <span className="label">Cor</span>
                    <div className="color-options">
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => <button type="button" key={c} style={{ '--c': seriesColor(c) }} className={color === c ? 'active' : ''} onClick={() => setColor(c)} aria-label={`Cor ${c}`} />)}
                    </div>
                </div>
                <div className="field">
                    <span className="label">Ícone</span>
                    <div className="icon-options">
                        {Object.keys(PICKABLE_ICONS).map((k) => (
                            <button type="button" key={k} className={icon === k ? 'active' : ''} onClick={() => setIcon(k)} aria-label={k}><Icon name={k} size={17} /></button>
                        ))}
                    </div>
                </div>
                {error && <div className="callout danger mt" role="alert">{error}</div>}
            </form>
        </Modal>
    );
}

export function Budget() {
    const { categories, transactions, today } = useData();
    const [month, setMonth] = useState(monthOf(today));
    const [editing, setEditing] = useState(null);

    const spent = useMemo(() => expensesByCategory(transactions, month), [transactions, month]);
    const expenseCats = categories.filter((c) => c.kind === 'expense');
    const withBudget = expenseCats.filter((c) => Number(c.budget) > 0)
        .map((c) => {
            const used = spent.get(c.id) || 0;
            const ratio = used / c.budget;
            return { c, used, ratio, level: budgetLevel(ratio) };
        })
        .sort((a, b) => b.ratio - a.ratio);
    const without = expenseCats.filter((c) => !(Number(c.budget) > 0));
    const incomeCats = categories.filter((c) => c.kind === 'income');

    const totalBudget = withBudget.reduce((a, b) => a + Number(b.c.budget), 0);
    const totalUsed = withBudget.reduce((a, b) => a + b.used, 0);
    const isCurrent = month === monthOf(today);
    const { year, month: m } = splitMonth(month);
    const elapsed = isCurrent ? Number(today.slice(8, 10)) / daysInMonth(year, m) : 1;
    const alerts = withBudget.filter((b) => b.level !== 'ok');

    return (
        <div className="page">
            <Topbar eyebrow="Limites por categoria" title="Orçamento">
                <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}><Plus size={16} /> Categoria</button>
            </Topbar>

            <div className="toolbar"><MonthPicker value={month} onChange={setMonth} /></div>

            {withBudget.length > 0 && (
                <div className="card">
                    <div className="goal-amounts">
                        <span>
                            <span className="eyebrow">Orçamento do mês</span>
                            <br />
                            <strong className="num">{money(totalUsed)}</strong> <span className="muted">/ {money(totalBudget)}</span>
                        </span>
                        <span className={`delta ${totalUsed > totalBudget ? 'bad' : 'good'}`}>{percent(totalUsed / totalBudget)}</span>
                    </div>
                    <div className="mt"><Progress ratio={totalUsed / totalBudget} level={budgetLevel(totalUsed / totalBudget)} large label="Orçamento total" /></div>
                    {isCurrent && (
                        <p className="hint mt">
                            {percent(elapsed)} do mês já passou. {totalUsed / totalBudget > elapsed + 0.05
                                ? 'Você está gastando mais rápido que o ritmo do mês.'
                                : 'Você está dentro do ritmo do mês.'}
                        </p>
                    )}
                </div>
            )}

            {alerts.length > 0 && (
                <div className="callout">
                    <TriangleAlert size={16} />
                    <span>{alerts.map((a) => `${a.c.name} (${percent(a.ratio)})`).join(', ')} {alerts.length === 1 ? 'está' : 'estão'} perto ou acima do limite.</span>
                </div>
            )}

            <div className="card">
                <div className="card-head"><h2>Com limite</h2></div>
                {withBudget.length ? withBudget.map(({ c, used, ratio, level }) => (
                    <div className="budget-row" key={c.id}>
                        <div className="budget-top">
                            <CategoryIcon category={c} />
                            <button className="list-main" style={{ textAlign: 'left' }} onClick={() => navigate('/lancamentos', { categoria: c.id, mes: month })}>
                                <span className="list-title">{c.name}</span>
                                <span className="list-sub">{money(used)} / {money(c.budget)} utilizados</span>
                            </button>
                            <span className={`list-amount ${level === 'over' ? 'neg' : ''}`}>{percent(ratio)}</span>
                            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(c)}>Editar</button>
                        </div>
                        <Progress ratio={ratio} level={level} color={seriesColor(c.color)} label={`${c.name}: ${percent(ratio)} do orçamento`} />
                        <div className="budget-meta">
                            <span>{level === 'over' ? `Passou ${money(used - c.budget)}` : `Restam ${money(c.budget - used)}`}</span>
                            {level === 'warn' && <span className="tag gold">Perto do limite</span>}
                            {level === 'over' && <span className="tag red">Acima do limite</span>}
                        </div>
                    </div>
                )) : (
                    <EmptyState icon="piggy" title="Nenhum limite definido">
                        Defina quanto quer gastar por mês em cada categoria. Ex.: Alimentação — R$ 800.
                    </EmptyState>
                )}
            </div>

            <div className="grid grid-2">
                <div className="card">
                    <div className="card-head"><h2>Despesas sem limite</h2></div>
                    <div className="list">
                        {without.map((c) => (
                            <button className="list-row" key={c.id} onClick={() => setEditing(c)}>
                                <CategoryIcon category={c} size="sm" />
                                <span className="list-main"><span className="list-title">{c.name}</span><span className="list-sub">{money(spent.get(c.id) || 0)} no mês</span></span>
                                <span className="card-link">Definir limite</span>
                            </button>
                        ))}
                        {!without.length && <p className="soft small">Todas as categorias de despesa têm limite.</p>}
                    </div>
                </div>
                <div className="card">
                    <div className="card-head"><h2>Categorias de receita</h2></div>
                    <div className="list">
                        {incomeCats.map((c) => (
                            <button className="list-row" key={c.id} onClick={() => setEditing(c)}>
                                <CategoryIcon category={c} size="sm" />
                                <span className="list-main"><span className="list-title">{c.name}</span></span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {editing && <CategoryForm category={editing.id ? editing : null} onClose={() => setEditing(null)} />}
        </div>
    );
}
