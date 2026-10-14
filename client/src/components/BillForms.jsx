import { Info, Pencil, Repeat } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BILL_CATEGORIES, BILL_PAYMENT_MODES, BILL_RECURRENCES } from '../lib/defaults.js';
import { BILL_STATUS, billsLedger, defaultAccountId, isCredit, validateBillPayment } from '../lib/finance.js';
import { deleteBill, deleteBillPayment, saveBill, saveBillPayment } from '../lib/bills.js';
import { money, parseAmount, round2, shortDate } from '../lib/format.js';
import { save } from '../lib/store.js';
import { useData, useUI } from '../state.jsx';
import { Icon } from './Icon.jsx';
import { Modal, Progress } from './ui.jsx';

const STATUS_TAG = { pending: 'gold', partial: 'blue', paid: 'green', overdue: 'red' };

export function BillStatusTag({ status }) {
    return <span className={`tag ${STATUS_TAG[status]}`}>{BILL_STATUS[status]}</span>;
}

/** Cor do ícone da conta: paga, atrasada, vence em breve, parcial ou pendente. */
export function billColor(entry) {
    if (entry.status === 'paid') return 'var(--green)';
    if (entry.status === 'overdue') return 'var(--red)';
    if (entry.soon) return 'var(--gold)';
    if (entry.status === 'partial') return 'var(--blue)';
    return 'var(--ink-muted)';
}

/** "vence hoje", "vence em 3 dias", "venceu há 2 dias". */
export function dueText(entry) {
    if (entry.status === 'paid') return 'paga';
    const d = entry.daysLeft;
    if (d === 0) return 'vence hoje';
    if (d === 1) return 'vence amanhã';
    if (d > 1) return `vence em ${d} dias`;
    return d === -1 ? 'venceu ontem' : `venceu há ${-d} dias`;
}

const amountText = (v) => (v ? String(round2(v)).replace('.', ',') : '');

// ------------------------------------------------------------
// Cadastro / edição da conta
// ------------------------------------------------------------

export function BillForm({ bill, onClose }) {
    const ui = useUI();
    const { today, billLedger } = useData();
    const editing = Boolean(bill?.id);
    const entry = editing ? billLedger.byId.get(bill.id) : null;
    const [description, setDescription] = useState(bill?.description || '');
    const [amount, setAmount] = useState(amountText(bill?.amount));
    const [dueDate, setDueDate] = useState(bill?.dueDate || today);
    const [category, setCategory] = useState(bill?.category || 'other');
    const [recurrence, setRecurrence] = useState(bill?.recurrence || 'once');
    const [notes, setNotes] = useState(bill?.notes || '');
    const [error, setError] = useState('');

    async function submit(e) {
        e.preventDefault();
        const value = parseAmount(amount);
        if (!description.trim()) return setError('Dê um nome à conta.');
        if (!(value > 0)) return setError('Informe o valor total a pagar.');
        if (!dueDate) return setError('Informe a data de vencimento.');
        if (entry && round2(value) < entry.paid) return setError(`Esta conta já recebeu ${money(entry.paid)} em pagamentos. O valor não pode ser menor que isso.`);
        const dueDay = Number(dueDate.slice(8, 10));
        await saveBill({
            ...bill,
            description: description.trim(),
            amount: value,
            dueDate,
            // O dia escolhido vale para as próximas competências (31 vira 28/30 quando precisa).
            dueDay: editing && bill.dueDate === dueDate ? bill.dueDay || dueDay : dueDay,
            category,
            recurrence,
            notes: notes.trim(),
        });
        ui.toast(editing ? 'Conta atualizada.' : 'Conta cadastrada.', 'success');
        onClose();
    }

    async function onDelete() {
        const n = entry?.payments.length || 0;
        const ok = await ui.confirm({
            title: `Excluir "${bill.description}"?`,
            message: [
                n ? `${n === 1 ? 'O pagamento registrado' : `Os ${n} pagamentos registrados`} (${money(entry.paid)}) e ${n === 1 ? 'o seu lançamento' : 'os lançamentos deles'} também serão excluídos: o valor volta ao saldo das contas e o que saiu da reserva volta para a reserva.` : '',
                bill.recurrence === 'monthly' ? 'Por ser mensal, as próximas competências deixam de ser geradas a partir desta.' : '',
            ].filter(Boolean).join(' ') || 'A conta sai da lista.',
            confirmLabel: 'Excluir',
            danger: true,
        });
        if (!ok) return;
        const undo = await deleteBill(bill.id);
        onClose();
        ui.toast('Conta excluída.', 'info', { label: 'Desfazer', run: undo });
    }

    return (
        <Modal
            title={editing ? 'Editar conta' : 'Nova conta a pagar'}
            onClose={onClose}
            footer={(
                <>
                    {editing && <button type="button" className="btn btn-danger" onClick={onDelete}>Excluir</button>}
                    <button type="submit" form="bill-form" className="btn btn-primary">Salvar</button>
                </>
            )}
        >
            <form id="bill-form" onSubmit={submit} noValidate>
                <div className="field">
                    <label className="label" htmlFor="bill-desc">Descrição</label>
                    <input id="bill-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Faculdade, internet, financiamento do carro" maxLength={60} data-autofocus />
                </div>
                <div className="field-row">
                    <div className="field">
                        <label className="label" htmlFor="bill-amount">Valor total</label>
                        <div className="input-affix"><input id="bill-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0,00" autoComplete="off" /><span className="affix">R$</span></div>
                    </div>
                    <div className="field">
                        <label className="label" htmlFor="bill-due">Vencimento</label>
                        <input id="bill-due" type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                    </div>
                </div>
                <div className="field">
                    <span className="label">Categoria</span>
                    <div className="chips" role="radiogroup" aria-label="Categoria">
                        {Object.entries(BILL_CATEGORIES).map(([id, c]) => (
                            <button key={id} type="button" role="radio" aria-checked={category === id} className={`chip${category === id ? ' active' : ''}`} onClick={() => setCategory(id)}>
                                <Icon name={c.icon} size={14} /> {c.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="field">
                    <span className="label">Recorrência</span>
                    <div className="segmented" role="radiogroup" aria-label="Recorrência">
                        {Object.entries(BILL_RECURRENCES).map(([id, label]) => (
                            <button key={id} type="button" role="radio" aria-checked={recurrence === id} className={recurrence === id ? 'active' : ''} onClick={() => setRecurrence(id)}>{label}</button>
                        ))}
                    </div>
                    {recurrence === 'monthly' && <span className="hint">Quando esta competência for paga, a do mês seguinte é criada sozinha, com o mesmo valor e dia de vencimento.</span>}
                </div>
                <div className="field">
                    <label className="label" htmlFor="bill-notes">Observações <span className="muted">(opcional)</span></label>
                    <textarea id="bill-notes" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="Ex.: código de barras, contrato, contato" />
                </div>
                {entry && (
                    <p className="hint">Status atual: <BillStatusTag status={entry.status} /> — calculado pelos pagamentos e pela data de vencimento.</p>
                )}
                {error && <div className="callout danger mt" role="alert">{error}</div>}
            </form>
        </Modal>
    );
}

// ------------------------------------------------------------
// Pagamento (total ou parcial)
// ------------------------------------------------------------

/** Formulário de pagamento. `full` = abre já com o valor que falta ("Marcar como paga"). */
export function BillPaymentForm({ billId, paymentId, full = false, onClose }) {
    const data = useData();
    const ui = useUI();
    const { today, activeAccounts, transactions, profile, billPayments, categories } = data;
    const payment = paymentId ? billPayments.find((p) => p.id === paymentId) : null;
    const bill = data.billLedger.byId.get(billId || payment?.billId)?.bill;
    const editing = Boolean(payment);

    // Para editar, o pagamento atual não conta contra ele mesmo (saldo da conta e da reserva).
    const ledger = useMemo(() => (editing
        ? billsLedger({ bills: data.billLedger.bills.map((e) => e.bill), payments: billPayments.filter((p) => p.id !== payment.id), reserveMoves: data.reserveMoves }, today)
        : data.billLedger), [editing, data.billLedger, billPayments, payment?.id, data.reserveMoves, today]);
    const entry = bill ? ledger.byId.get(bill.id) : null;
    const reserve = Math.max(ledger.totals.reserve, 0);

    const cashAccounts = activeAccounts.filter((a) => !isCredit(a));
    const cards = activeAccounts.filter(isCredit);
    const initialMode = payment?.mode || (bill?.category === 'card' && cards.length ? 'transfer' : 'expense');
    const initialAmount = payment?.amount ?? (full ? entry?.remaining : 0);

    const [amount, setAmount] = useState(amountText(initialAmount));
    const [fromReserve, setFromReserve] = useState(amountText(payment ? payment.fromReserve : Math.min(initialAmount || 0, reserve)));
    const [reserveTouched, setReserveTouched] = useState(editing);
    const [date, setDate] = useState(payment?.date || today);
    const [mode, setMode] = useState(initialMode);
    const [accountId, setAccountId] = useState(() => payment?.accountId
        || defaultAccountId({ accounts: activeAccounts, transactions, profile, type: 'expense', preferredId: cashAccounts[0]?.id }));
    const [toAccountId, setToAccountId] = useState(payment?.toAccountId || cards[0]?.id || '');
    const [categoryId, setCategoryId] = useState(payment?.categoryId || bill?.expenseCategoryId || BILL_CATEGORIES[bill?.category]?.expense || categories[0]?.id || '');
    const [notes, setNotes] = useState(payment?.notes || '');
    const [error, setError] = useState('');

    if (!bill || !entry) return null;

    const value = parseAmount(amount);
    const reserved = parseAmount(fromReserve) || 0;
    const after = round2(entry.remaining - (value > 0 ? value : 0));
    const accounts = mode === 'expense' ? activeAccounts : cashAccounts;
    const expenseCategories = categories.filter((c) => c.kind === 'expense');

    function changeAmount(text) {
        setAmount(text);
        setError('');
        if (!reserveTouched) setFromReserve(amountText(Math.min(parseAmount(text) || 0, reserve)));
    }

    async function submit(e) {
        e?.preventDefault();
        const problem = validateBillPayment(entry, reserve, { amount: value, fromReserve: reserved });
        if (problem) return setError(problem);
        if (mode !== 'none' && !accountId) return setError('Escolha de qual conta o dinheiro saiu.');
        if (mode === 'transfer' && !toAccountId) return setError('Escolha o cartão cuja fatura foi paga.');
        if (mode === 'expense' && !categoryId) return setError('Escolha a categoria da despesa.');

        // A categoria escolhida vira a sugestão dos próximos pagamentos (e das próximas competências).
        const target = mode === 'expense' && categoryId !== bill.expenseCategoryId
            ? await save('bills', { ...bill, expenseCategoryId: categoryId }) : bill;
        await saveBillPayment({
            ...payment,
            amount: value,
            fromReserve: reserved,
            date,
            mode,
            accountId: mode === 'none' ? null : accountId,
            toAccountId: mode === 'transfer' ? toAccountId : null,
            categoryId: mode === 'expense' ? categoryId : null,
            notes: notes.trim(),
        }, target);

        ui.toast(editing
            ? 'Pagamento atualizado.'
            : after > 0 ? `Pagamento de ${money(value)} registrado. Falta ${money(after)}.` : `"${bill.description}" quitada.`, 'success');
        onClose();
    }

    async function onDelete() {
        const ok = await ui.confirm({
            title: 'Excluir pagamento?',
            message: `${money(payment.amount)} pagos em ${shortDate(payment.date, today)}. O valor volta a ficar pendente na conta${payment.mode !== 'none' ? ', o lançamento é excluído (o dinheiro volta ao saldo)' : ''}${payment.fromReserve > 0 ? ` e ${money(payment.fromReserve)} voltam para a reserva` : ''}.`,
            confirmLabel: 'Excluir',
            danger: true,
        });
        if (!ok) return;
        const undo = await deleteBillPayment(payment.id);
        onClose();
        ui.toast('Pagamento excluído.', 'info', { label: 'Desfazer', run: undo });
    }

    return (
        <Modal
            title={editing ? 'Editar pagamento' : `Pagar "${bill.description}"`}
            onClose={onClose}
            footer={(
                <>
                    {editing && <button type="button" className="btn btn-danger" onClick={onDelete}>Excluir</button>}
                    <button type="submit" form="billpay-form" className="btn btn-primary">{editing ? 'Salvar alterações' : 'Registrar pagamento'}</button>
                </>
            )}
        >
            <form id="billpay-form" onSubmit={submit} noValidate>
                <div className="pay-balance" aria-live="polite">
                    <span>Falta pagar <b className="num">{money(entry.remaining)}</b></span>
                    {value > 0 && <span>Depois deste pagamento <b className={`num ${after < 0 ? 'neg' : ''}`}>{money(after)}</b></span>}
                </div>

                <div className="field mt">
                    <label className="label" htmlFor="bp-amount">Valor pago</label>
                    <div className="input-affix lg">
                        <input id="bp-amount" className="input input-lg" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => changeAmount(e.target.value.replace(/[^\d.,]/g, ''))} autoComplete="off" data-autofocus />
                        <span className="affix">R$</span>
                    </div>
                    {entry.remaining > 0 && (
                        <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={() => changeAmount(amountText(entry.remaining))}>
                            Pagar tudo ({money(entry.remaining)})
                        </button>
                    )}
                </div>

                <div className="field-row" style={{ alignItems: 'start' }}>
                    <div className="field">
                        <label className="label" htmlFor="bp-date">Data do pagamento</label>
                        <input id="bp-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value || today)} />
                    </div>
                    <div className="field">
                        <label className="label" htmlFor="bp-reserve">Usar da reserva</label>
                        <div className="input-affix">
                            <input id="bp-reserve" className="input" inputMode="decimal" placeholder="0,00" value={fromReserve} onChange={(e) => { setFromReserve(e.target.value.replace(/[^\d.,]/g, '')); setReserveTouched(true); setError(''); }} autoComplete="off" disabled={reserve <= 0} />
                            <span className="affix">R$</span>
                        </div>
                        <span className="hint">{reserve > 0 ? `Disponível na reserva: ${money(reserve)}` : 'A reserva está vazia.'}</span>
                    </div>
                </div>

                <div className="field">
                    <span className="label">Como lançar no Caderneta</span>
                    <div className="segmented" role="radiogroup" aria-label="Como lançar">
                        {Object.entries(BILL_PAYMENT_MODES).filter(([id]) => id !== 'transfer' || cards.length).map(([id, label]) => (
                            <button key={id} type="button" role="radio" aria-checked={mode === id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}>{label}</button>
                        ))}
                    </div>
                    <span className="hint">
                        {mode === 'expense' && 'Cria uma despesa na conta escolhida: o saldo cai uma única vez.'}
                        {mode === 'transfer' && 'Transferência da conta para o cartão. As compras do cartão já são despesas; lançar a fatura como despesa contaria o gasto duas vezes.'}
                        {mode === 'none' && 'Nenhum lançamento é criado: use quando a despesa já está em Lançamentos (por exemplo, gerada por uma recorrência).'}
                    </span>
                </div>

                {mode !== 'none' && (
                    <div className="field-row">
                        <div className="field">
                            <label className="label" htmlFor="bp-account">Saiu de</label>
                            <select id="bp-account" className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                                {!accounts.some((a) => a.id === accountId) && <option value="">Escolha…</option>}
                                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                        </div>
                        {mode === 'transfer' ? (
                            <div className="field">
                                <label className="label" htmlFor="bp-card">Cartão</label>
                                <select id="bp-card" className="select" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                                    {cards.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                </select>
                            </div>
                        ) : (
                            <div className="field">
                                <label className="label" htmlFor="bp-cat">Categoria da despesa</label>
                                <select id="bp-cat" className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                                    {!expenseCategories.some((c) => c.id === categoryId) && <option value="">Escolha…</option>}
                                    {expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                        )}
                    </div>
                )}

                <div className="field">
                    <label className="label" htmlFor="bp-notes">Observação <span className="muted">(opcional)</span></label>
                    <input id="bp-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="Ex.: pago no app do banco" />
                </div>

                {error && <div className="callout danger mt" role="alert">{error}</div>}
                <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
            </form>
        </Modal>
    );
}

// ------------------------------------------------------------
// Reserva: adicionar / retirar
// ------------------------------------------------------------

export function ReserveForm({ withdraw = false, onClose }) {
    const ui = useUI();
    const { today, billLedger } = useData();
    const reserve = Math.max(billLedger.totals.reserve, 0);
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(today);
    const [note, setNote] = useState('');
    const [error, setError] = useState('');

    async function submit(e) {
        e.preventDefault();
        const value = parseAmount(amount);
        if (!(value > 0)) return setError('Informe um valor.');
        if (withdraw && round2(value) > round2(reserve)) return setError(`A reserva tem ${money(reserve)}.`);
        await save('reserveMoves', { amount: round2(withdraw ? -value : value), date, note: note.trim() });
        ui.toast(withdraw ? `− ${money(value)} da reserva.` : `+ ${money(value)} na reserva.`, 'success');
        onClose();
    }

    return (
        <Modal
            title={withdraw ? 'Retirar da reserva' : 'Adicionar à reserva'}
            onClose={onClose}
            footer={<button type="submit" form="reserve-form" className="btn btn-primary">{withdraw ? 'Retirar' : 'Adicionar'}</button>}
        >
            <form id="reserve-form" onSubmit={submit} noValidate>
                <div className="pay-balance"><span>Reservado agora <b className="num">{money(reserve)}</b></span></div>
                <div className="field mt">
                    <label className="label" htmlFor="res-amount">Valor</label>
                    <div className="input-affix lg"><input id="res-amount" className="input input-lg" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d.,]/g, '')); setError(''); }} placeholder="0,00" autoComplete="off" data-autofocus /><span className="affix">R$</span></div>
                </div>
                <div className="field-row">
                    <div className="field">
                        <label className="label" htmlFor="res-date">Data</label>
                        <input id="res-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value || today)} />
                    </div>
                    <div className="field">
                        <label className="label" htmlFor="res-note">Nota</label>
                        <input id="res-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={60} placeholder={withdraw ? 'Ex.: emergência' : 'Ex.: parte do salário'} />
                    </div>
                </div>
                <div className="callout info mt">
                    <Info size={16} />
                    <span>A reserva não muda o saldo das suas contas: ela marca quanto desse saldo já está separado para as contas a pagar.</span>
                </div>
                {error && <div className="callout danger mt" role="alert">{error}</div>}
            </form>
        </Modal>
    );
}

// ------------------------------------------------------------
// Detalhe da conta: resumo, histórico de pagamentos e ações
// ------------------------------------------------------------

export function BillDetail({ billId, onClose, onEdit }) {
    const ui = useUI();
    const { billLedger, today, accountById, categoryById } = useData();
    const entry = billLedger.byId.get(billId);
    if (!entry) return null;
    const { bill } = entry;
    const cat = BILL_CATEGORIES[bill.category] || BILL_CATEGORIES.other;
    const pay = (full) => { onClose(); ui.openBillPayment({ billId, full }); };

    return (
        <Modal
            title={bill.description}
            onClose={onClose}
            footer={entry.status === 'paid' ? (
                <button type="button" className="btn btn-secondary" onClick={() => { onClose(); onEdit(bill); }}><Pencil size={15} /> Editar</button>
            ) : (
                <>
                    <button type="button" className="btn btn-secondary" onClick={() => pay(false)}>Pagamento parcial</button>
                    <button type="button" className="btn btn-primary" onClick={() => pay(true)}>Marcar como paga</button>
                </>
            )}
        >
            <div className="row wrap" style={{ gap: 8 }}>
                <span className="cat-icon" style={{ '--c': billColor(entry) }} aria-hidden="true"><Icon name={cat.icon} size={18} /></span>
                <div className="list-main">
                    <span className="list-sub">
                        <span>{cat.label}</span>
                        <BillStatusTag status={entry.status} />
                        {bill.recurrence === 'monthly' && <span className="tag"><Repeat size={11} /> Mensal</span>}
                    </span>
                    <span className="list-sub">Vencimento {shortDate(bill.dueDate, today)} · {dueText(entry)}</span>
                </div>
                {entry.status !== 'paid' && (
                    <button className="btn-icon sm" onClick={() => { onClose(); onEdit(bill); }} aria-label="Editar conta"><Pencil size={16} /></button>
                )}
            </div>

            <div className="bill-figures mt">
                <div><span>Valor total</span><b className="num">{money(entry.amount)}</b></div>
                <div><span>Pago</span><b className="num pos">{money(entry.paid)}</b></div>
                <div><span>Falta</span><b className="num">{money(entry.remaining)}</b></div>
            </div>
            <Progress ratio={entry.amount ? entry.paid / entry.amount : 0} color="var(--green)" label={`Pago ${money(entry.paid)} de ${money(entry.amount)}`} />

            {bill.notes && <p className="soft mt" style={{ whiteSpace: 'pre-wrap' }}>{bill.notes}</p>}

            <h3 className="label mt">Histórico de pagamentos</h3>
            {entry.payments.length ? (
                <div className="list">
                    {[...entry.payments].reverse().map((p) => {
                        const from = accountById.get(p.accountId);
                        const to = accountById.get(p.toAccountId);
                        const category = categoryById.get(p.categoryId);
                        return (
                            <button className="list-row" key={p.id} onClick={() => { onClose(); ui.openBillPayment({ paymentId: p.id }); }}>
                                <span className="list-main">
                                    <span className="list-title">{shortDate(p.date, today)}</span>
                                    <span className="list-sub">
                                        {p.mode === 'transfer' && <span>{from?.name} → {to?.name}</span>}
                                        {p.mode === 'expense' && <span>{category?.name || 'Despesa'}{from ? ` · ${from.name}` : ''}</span>}
                                        {p.mode === 'none' && <span>sem lançamento</span>}
                                        {p.fromReserve > 0 && <span className="tag gold">{money(p.fromReserve)} da reserva</span>}
                                        {p.date > today && <span className="tag">Agendado</span>}
                                    </span>
                                    {p.notes && <span className="list-sub">“{p.notes}”</span>}
                                </span>
                                <span className="list-amount">− {money(p.amount)}</span>
                            </button>
                        );
                    })}
                </div>
            ) : <p className="hint">Nenhum pagamento ainda.</p>}
        </Modal>
    );
}
