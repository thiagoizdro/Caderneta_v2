import { Archive, CreditCard, Pencil, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Topbar } from '../components/Topbar.jsx';
import { Icon, seriesColor } from '../components/Icon.jsx';
import { EmptyState, Modal, Progress } from '../components/ui.jsx';
import { shortDate as fmtShort, money, parseAmount, percent, round2 } from '../lib/format.js';
import { ACCOUNT_TYPES } from '../lib/defaults.js';
import { accountBalances, cardSummary, isCredit } from '../lib/finance.js';
import { monthLabel } from '../lib/dates.js';
import { remove, save } from '../lib/store.js';
import { useData, useUI } from '../state.jsx';

const TYPE_ICONS = { wallet: 'wallet', checking: 'bank', savings: 'piggy', credit: 'card', other: 'cash' };
const CARD_COLORS = ['#2f4858', '#5b2a86', '#1f5f4a', '#8a3b12', '#1d3557', '#3d3d3d'];

function AccountForm({ account, onClose }) {
    const ui = useUI();
    const { transactions } = useData();
    const editing = Boolean(account?.id);
    const [name, setName] = useState(account?.name || '');
    const [type, setType] = useState(account?.type || 'checking');
    const [initial, setInitial] = useState(account?.initialBalance ? String(account.initialBalance).replace('.', ',') : '');
    const [limit, setLimit] = useState(account?.creditLimit ? String(account.creditLimit).replace('.', ',') : '');
    const [closingDay, setClosingDay] = useState(account?.closingDay || 1);
    const [dueDay, setDueDay] = useState(account?.dueDay || 10);
    const [color, setColor] = useState(account?.color ?? 1);
    const [cardColor, setCardColor] = useState(account?.cardColor || CARD_COLORS[0]);
    const [error, setError] = useState('');
    const credit = type === 'credit';

    async function submit(e) {
        e.preventDefault();
        if (!name.trim()) return setError('Dê um nome à conta.');
        const initialBalance = initial ? parseAmount(initial) : 0;
        if (Number.isNaN(initialBalance)) return setError('Saldo inicial inválido.');
        const creditLimit = credit ? parseAmount(limit) : 0;
        if (credit && !(creditLimit > 0)) return setError('Informe o limite do cartão.');
        const cd = Number(closingDay);
        const dd = Number(dueDay);
        if (credit && !(cd >= 1 && cd <= 31 && dd >= 1 && dd <= 31)) return setError('Dias de fechamento e vencimento: de 1 a 31.');

        await save('accounts', {
            ...account,
            name: name.trim(),
            type,
            initialBalance: credit ? 0 : round2(initialBalance),
            creditLimit: credit ? round2(creditLimit) : null,
            closingDay: credit ? cd : null,
            dueDay: credit ? dd : null,
            color,
            cardColor: credit ? cardColor : null,
        });
        ui.toast(editing ? 'Conta atualizada.' : 'Conta criada.', 'success');
        onClose();
    }

    async function onArchive() {
        await save('accounts', { ...account, archived: !account.archived });
        ui.toast(account.archived ? 'Conta reativada.' : 'Conta arquivada. O histórico continua nos relatórios.', 'info');
        onClose();
    }

    async function onDelete() {
        const used = transactions.some((t) => t.accountId === account.id || t.toAccountId === account.id);
        if (used) {
            ui.toast('Esta conta tem lançamentos. Arquive-a para escondê-la sem perder o histórico.', 'warn');
            return;
        }
        if (!(await ui.confirm({ title: `Excluir "${account.name}"?`, confirmLabel: 'Excluir', danger: true }))) return;
        await remove('accounts', account.id);
        onClose();
    }

    return (
        <Modal
            title={editing ? 'Editar conta' : 'Nova conta'}
            onClose={onClose}
            footer={(
                <>
                    {editing && <button type="button" className="btn btn-secondary" onClick={onArchive}><Archive size={16} /> {account.archived ? 'Reativar' : 'Arquivar'}</button>}
                    {editing && <button type="button" className="btn btn-danger" onClick={onDelete}>Excluir</button>}
                    <button type="submit" form="acc-form" className="btn btn-primary">Salvar</button>
                </>
            )}
        >
            <form id="acc-form" onSubmit={submit} noValidate>
                <div className="field">
                    <label className="label" htmlFor="acc-type">Tipo</label>
                    <select id="acc-type" className="select" value={type} onChange={(e) => setType(e.target.value)} disabled={editing && isCredit(account)}>
                        {Object.entries(ACCOUNT_TYPES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                </div>
                <div className="field">
                    <label className="label" htmlFor="acc-name">Nome</label>
                    <input id="acc-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={credit ? 'Ex.: Nubank, Inter…' : 'Ex.: Conta do banco, Poupança…'} maxLength={40} data-autofocus />
                </div>
                {credit ? (
                    <>
                        <div className="field">
                            <label className="label" htmlFor="acc-limit">Limite</label>
                            <div className="input-affix"><input id="acc-limit" className="input" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="0,00" /><span className="affix">R$</span></div>
                        </div>
                        <div className="field-row">
                            <div className="field">
                                <label className="label" htmlFor="acc-close">Dia do fechamento</label>
                                <input id="acc-close" type="number" min={1} max={31} className="input" value={closingDay} onChange={(e) => setClosingDay(e.target.value)} />
                            </div>
                            <div className="field">
                                <label className="label" htmlFor="acc-due">Dia do vencimento</label>
                                <input id="acc-due" type="number" min={1} max={31} className="input" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
                            </div>
                        </div>
                        <div className="field">
                            <span className="label">Cor do cartão</span>
                            <div className="color-options">
                                {CARD_COLORS.map((c) => <button type="button" key={c} style={{ '--c': c }} className={cardColor === c ? 'active' : ''} onClick={() => setCardColor(c)} aria-label={`Cor ${c}`} />)}
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="field">
                            <label className="label" htmlFor="acc-initial">Saldo inicial</label>
                            <div className="input-affix"><input id="acc-initial" className="input" inputMode="decimal" value={initial} onChange={(e) => setInitial(e.target.value)} placeholder="0,00" /><span className="affix">R$</span></div>
                            <span className="hint">Quanto havia na conta antes do primeiro lançamento no Caderneta.</span>
                        </div>
                        <div className="field">
                            <span className="label">Cor</span>
                            <div className="color-options">
                                {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => <button type="button" key={c} style={{ '--c': seriesColor(c) }} className={color === c ? 'active' : ''} onClick={() => setColor(c)} aria-label={`Cor ${c}`} />)}
                            </div>
                        </div>
                    </>
                )}
                {error && <div className="callout danger mt" role="alert">{error}</div>}
            </form>
        </Modal>
    );
}

function CreditCardPanel({ card, onEdit }) {
    const { transactions, today, activeAccounts } = useData();
    const ui = useUI();
    const s = useMemo(() => cardSummary(card, transactions, today), [card, transactions, today]);
    const payFrom = activeAccounts.find((a) => !isCredit(a));
    const statusLabel = { closed: 'Fechada', overdue: 'Vencida', open: 'Aberta', paid: 'Paga' };

    const pay = (inv) => ui.openTx({
        type: 'transfer',
        amount: inv.remaining || inv.amount,
        accountId: payFrom?.id,
        toAccountId: card.id,
        description: `Pagamento da fatura ${card.name} (${monthLabel(inv.ym, { short: true })})`,
        date: today,
    });

    return (
        <div className="card account-card">
            <div className="credit-card-visual" style={{ '--cc': card.cardColor || CARD_COLORS[0] }}>
                <div className="cc-row">
                    <span className="cc-name">{card.name}</span>
                    <button className="btn-icon sm" style={{ color: 'inherit' }} onClick={onEdit} aria-label={`Editar ${card.name}`}><Pencil size={15} /></button>
                </div>
                <div>
                    <div className="cc-label">Fatura atual · fecha {fmtShort(s.current.closing, today)}</div>
                    <div className="cc-value">{money(s.current.amount)}</div>
                </div>
                <div className="cc-row">
                    <div><div className="cc-label">Disponível</div><strong className="num">{money(s.available)}</strong></div>
                    <div style={{ textAlign: 'right' }}><div className="cc-label">Vence</div><strong>{fmtShort(s.current.due, today)}</strong></div>
                </div>
            </div>
            <div>
                <div className="budget-meta"><span>Limite usado</span><span>{money(Math.max(s.committed, 0))} de {money(s.limit)} · {percent(s.usage)}</span></div>
                <div className="mt" style={{ marginTop: 6 }}><Progress ratio={s.usage} level={s.usage >= 1 ? 'over' : s.usage >= 0.8 ? 'warn' : 'ok'} label="Limite usado" /></div>
            </div>
            {s.toPay.length > 0 && (
                <div className="invoice-list">
                    {s.toPay.map((inv) => (
                        <div className="invoice" key={inv.ym} style={inv.status === 'overdue' ? { background: 'var(--red-wash)' } : undefined}>
                            <span className="list-main">
                                Fatura de {monthLabel(inv.ym, { short: true })} <span className={`tag ${inv.status === 'overdue' ? 'red' : 'gold'}`}>{statusLabel[inv.status]}</span>
                                <span className="list-sub">vence {fmtShort(inv.due, today)}</span>
                            </span>
                            <span className="list-amount">{money(inv.remaining)}</span>
                            <button className="btn btn-primary btn-sm" onClick={() => pay(inv)}>Pagar</button>
                        </div>
                    ))}
                </div>
            )}
            {s.upcoming.length > 0 && (
                <div>
                    <div className="label" style={{ marginBottom: 6 }}>Próximas faturas (parcelas já lançadas)</div>
                    <div className="invoice-list">
                        {s.upcoming.slice(0, 4).map((inv) => (
                            <div className="invoice" key={inv.ym}>
                                <span className="list-main">{monthLabel(inv.ym)}<span className="list-sub">{inv.items.length} {inv.items.length === 1 ? 'lançamento' : 'lançamentos'}</span></span>
                                <span className="list-amount">{money(inv.amount)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <div className="row wrap">
                <a className="btn btn-secondary btn-sm" href={`#/lancamentos?conta=${card.id}&mes=${s.current.ym}`}>Ver lançamentos</a>
                {s.current.amount > 0 && <button className="btn btn-ghost btn-sm" onClick={() => pay(s.current)}>Adiantar pagamento</button>}
            </div>
        </div>
    );
}

export function Accounts() {
    const { accounts, transactions, today } = useData();
    const [editing, setEditing] = useState(null);
    const [showArchived, setShowArchived] = useState(false);
    const balances = useMemo(() => accountBalances(accounts, transactions, today), [accounts, transactions, today]);

    const visible = accounts.filter((a) => showArchived || !a.archived);
    const cash = visible.filter((a) => !isCredit(a));
    const cards = visible.filter(isCredit);
    const totalCash = accounts.filter((a) => !isCredit(a)).reduce((acc, a) => acc + balances.get(a.id), 0);
    const totalDebt = accounts.filter(isCredit).reduce((acc, a) => acc + Math.max(-balances.get(a.id), 0), 0);
    const archivedCount = accounts.filter((a) => a.archived).length;

    return (
        <div className="page">
            <Topbar eyebrow="Onde está o dinheiro" title="Contas e cartões">
                <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}><Plus size={16} /> Nova conta</button>
            </Topbar>

            <section className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                <div className="card kpi hero"><span className="kpi-label">Em contas</span><span className="kpi-value num">{money(totalCash)}</span></div>
                <div className="card kpi"><span className="kpi-label">Dívida em cartões</span><span className="kpi-value num">{money(totalDebt)}</span></div>
                <div className="card kpi"><span className="kpi-label">Patrimônio líquido</span><span className={`kpi-value num ${totalCash - totalDebt < 0 ? 'neg' : ''}`}>{money(totalCash - totalDebt)}</span></div>
            </section>

            <div className="card">
                <div className="card-head"><h2>Contas</h2></div>
                {cash.length ? (
                    <div className="list">
                        {cash.map((a) => (
                            <button key={a.id} className="list-row" onClick={() => setEditing(a)}>
                                <span className="cat-icon" style={{ '--c': seriesColor(a.color) }}><Icon name={TYPE_ICONS[a.type]} /></span>
                                <span className="list-main">
                                    <span className="list-title">{a.name} {a.archived && <span className="tag">Arquivada</span>}</span>
                                    <span className="list-sub">{ACCOUNT_TYPES[a.type]}</span>
                                </span>
                                <span className={`list-amount ${balances.get(a.id) < 0 ? 'neg' : ''}`}>{money(balances.get(a.id))}</span>
                            </button>
                        ))}
                    </div>
                ) : <EmptyState icon="wallet" title="Nenhuma conta" />}
            </div>

            <div>
                <div className="row between" style={{ margin: '6px 4px 12px' }}>
                    <h2 style={{ fontSize: 17, fontWeight: 800 }}>Cartões de crédito</h2>
                    {archivedCount > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Ocultar' : 'Mostrar'} arquivadas ({archivedCount})</button>}
                </div>
                {cards.length ? (
                    <div className="grid grid-2">
                        {cards.map((c) => <CreditCardPanel key={c.id} card={c} onEdit={() => setEditing(c)} />)}
                    </div>
                ) : (
                    <div className="card">
                        <EmptyState
                            icon="card"
                            title="Nenhum cartão cadastrado"
                            action={<button className="btn btn-primary" onClick={() => setEditing({ type: 'credit' })}><CreditCard size={16} /> Adicionar cartão</button>}
                        >
                            Com o cartão cadastrado, o Caderneta separa as compras por fatura, acompanha o limite e lembra do vencimento.
                        </EmptyState>
                    </div>
                )}
            </div>

            {editing && <AccountForm account={editing.id ? editing : { type: editing.type }} onClose={() => setEditing(null)} />}
        </div>
    );
}
