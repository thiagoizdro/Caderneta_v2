import { Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import { monthLabel, monthOf } from '../lib/dates.js';
import { PAYMENT_METHODS, RECEIVABLE_ID } from '../lib/defaults.js';
import { WORKDAY_STATUS, defaultAccountId, isCredit, validateWorkPayment, workdayLedger } from '../lib/finance.js';
import { money, parseAmount, round2, shortDate } from '../lib/format.js';
import { db } from '../lib/db.js';
import { remove, save, saveMany } from '../lib/store.js';
import { useData, useUI } from '../state.jsx';
import { Modal } from './ui.jsx';

export const STATUS_TAG = { pending: 'gold', partial: 'blue', paid: 'green' };

export function WorkdayStatusTag({ status }) {
    return <span className={`tag ${STATUS_TAG[status]}`}>{WORKDAY_STATUS[status]}</span>;
}

/**
 * Pede confirmação antes de alterar ou excluir uma diária que já recebeu
 * pagamento. Devolve true para seguir.
 */
export async function confirmPaidWorkday(ui, entry, action = 'excluir') {
    if (!entry || entry.paid <= 0) return true;
    const paidText = entry.status === 'paid' ? 'já foi paga' : `já recebeu ${money(entry.paid)}`;
    return ui.confirm({
        title: `${action === 'excluir' ? 'Excluir' : 'Alterar'} diária ${entry.status === 'paid' ? 'paga' : 'parcialmente paga'}?`,
        message: entry.direct
            ? `A diária de ${shortDate(entry.date)} ${paidText} e o valor entrou direto na conta. ${action === 'excluir' ? 'Excluir tira esse valor do saldo da conta.' : 'O saldo da conta muda junto.'}`
            : `A diária de ${shortDate(entry.date)} ${paidText}. Os pagamentos registrados continuam no histórico; o valor deles passa para as próximas diárias pendentes ou fica como crédito com a empresa.`,
        confirmLabel: action === 'excluir' ? 'Excluir mesmo assim' : 'Alterar mesmo assim',
        danger: action === 'excluir',
    });
}

export function PaymentForm({ payment, onClose }) {
    const data = useData();
    const ui = useUI();
    const { today, activeAccounts, transactions, profile } = data;
    const editing = Boolean(payment?.id);

    // Para editar, o pagamento atual não pode contar contra ele mesmo.
    const ledger = useMemo(
        () => (editing ? workdayLedger(transactions.filter((t) => t.id !== payment.id)) : data.workLedger),
        [editing, transactions, payment?.id, data.workLedger],
    );
    const cashAccounts = activeAccounts.filter((a) => !isCredit(a));

    const [amountText, setAmountText] = useState(payment?.amount ? String(payment.amount).replace('.', ',') : '');
    const [amountTouched, setAmountTouched] = useState(editing);
    const [date, setDate] = useState(payment?.date || today);
    const [method, setMethod] = useState(payment?.method || 'pix');
    const [accountId, setAccountId] = useState(() => payment?.toAccountId
        || defaultAccountId({ accounts: activeAccounts, transactions, profile, type: 'income', preferredId: profile.workAccountId }));
    const [notes, setNotes] = useState(payment?.notes || '');
    const [selected, setSelected] = useState(() => new Set((payment?.workdayIds || []).filter((id) => ledger.byId.has(id))));
    const [error, setError] = useState('');

    // Diárias que ainda podem receber pagamento, agrupadas por mês (mais recentes primeiro).
    const open = useMemo(() => ledger.days.filter((d) => d.remaining > 0), [ledger]);
    const months = useMemo(() => {
        const map = new Map();
        for (const d of open) {
            const ym = monthOf(d.date);
            if (!map.has(ym)) map.set(ym, []);
            map.get(ym).push(d);
        }
        return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
    }, [open]);

    const amount = parseAmount(amountText);
    const selectedTotal = round2([...selected].reduce((acc, id) => acc + (ledger.byId.get(id)?.remaining || 0), 0));
    const pendingAfter = round2(ledger.totals.pending - (amount > 0 ? amount : 0));

    function changeSelection(ids, on) {
        const next = new Set(selected);
        ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
        setSelected(next);
        setError('');
        if (!amountTouched) {
            const total = round2([...next].reduce((acc, id) => acc + (ledger.byId.get(id)?.remaining || 0), 0));
            setAmountText(total > 0 ? String(total).replace('.', ',') : '');
        }
    }

    async function submit(e) {
        e?.preventDefault();
        const workdayIds = [...selected];
        const problem = validateWorkPayment(ledger, { amount, workdayIds });
        if (problem) return setError(problem);
        if (!accountId) return setError('Escolha a conta onde o dinheiro entrou.');

        await save('transactions', {
            ...payment,
            type: 'transfer',
            source: 'workpayment',
            amount: round2(amount),
            date,
            description: 'Pagamento de diárias',
            categoryId: null,
            accountId: RECEIVABLE_ID,
            toAccountId: accountId,
            person: '',
            method,
            notes: notes.trim(),
            workdayIds,
        });
        ui.toast(editing
            ? 'Pagamento atualizado. Saldos recalculados.'
            : `Pagamento de ${money(amount)} registrado. Falta receber ${money(pendingAfter)}.`, 'success');
        onClose();
    }

    async function onDelete() {
        const ok = await ui.confirm({
            title: 'Excluir pagamento?',
            message: `${money(payment.amount)} recebidos em ${shortDate(payment.date, today)}. As diárias cobertas por ele voltam a ficar a receber e o valor sai do saldo da conta.`,
            confirmLabel: 'Excluir',
            danger: true,
        });
        if (!ok) return;
        const snapshot = await db.transactions.get(payment.id);
        await remove('transactions', payment.id);
        onClose();
        ui.toast('Pagamento excluído. Saldos recalculados.', 'info', {
            label: 'Desfazer',
            run: () => saveMany('transactions', [snapshot].filter(Boolean)),
        });
    }

    return (
        <Modal
            title={editing ? 'Editar pagamento' : 'Registrar pagamento'}
            onClose={onClose}
            wide
            footer={(
                <>
                    {editing && <button type="button" className="btn btn-danger" onClick={onDelete}>Excluir</button>}
                    <button type="submit" form="pay-form" className="btn btn-primary">{editing ? 'Salvar alterações' : 'Registrar pagamento'}</button>
                </>
            )}
        >
            <form id="pay-form" onSubmit={submit} noValidate>
                <div className="pay-balance" aria-live="polite">
                    <span>A receber <b className="num">{money(ledger.totals.pending)}</b></span>
                    {amount > 0 && <span>Depois deste pagamento <b className={`num ${pendingAfter < 0 ? 'neg' : ''}`}>{money(pendingAfter)}</b></span>}
                </div>

                <div className="field mt">
                    <label className="label" htmlFor="pay-amount">Valor recebido</label>
                    <div className="input-affix lg">
                        <input
                            id="pay-amount"
                            className="input input-lg"
                            inputMode="decimal"
                            placeholder="0,00"
                            value={amountText}
                            onChange={(e) => { setAmountText(e.target.value.replace(/[^\d.,]/g, '')); setAmountTouched(true); setError(''); }}
                            autoComplete="off"
                            data-autofocus
                        />
                        <span className="affix">R$</span>
                    </div>
                    {ledger.totals.pending > 0 && (
                        <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={() => { setAmountText(String(ledger.totals.pending).replace('.', ',')); setAmountTouched(true); }}>
                            Recebi tudo ({money(ledger.totals.pending)})
                        </button>
                    )}
                </div>

                <div className="field">
                    <span className="label">Forma de pagamento</span>
                    <div className="segmented" role="radiogroup" aria-label="Forma de pagamento">
                        {Object.entries(PAYMENT_METHODS).map(([id, label]) => (
                            <button key={id} type="button" role="radio" aria-checked={method === id} className={method === id ? 'active' : ''} onClick={() => setMethod(id)}>{label}</button>
                        ))}
                    </div>
                </div>

                <div className="field-row">
                    <div className="field">
                        <label className="label" htmlFor="pay-date">Data</label>
                        <input id="pay-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value || today)} />
                    </div>
                    <div className="field">
                        <label className="label" htmlFor="pay-account">Entrou em</label>
                        <select id="pay-account" className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                            {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                    </div>
                </div>

                <div className="field">
                    <label className="label" htmlFor="pay-notes">Observação <span className="muted">(opcional)</span></label>
                    <input id="pay-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder="Ex.: acerto da quinzena" />
                </div>

                <div className="field">
                    <span className="label">Diárias correspondentes <span className="muted">(opcional)</span></span>
                    {open.length ? (
                        <>
                            <span className="hint">
                                {selected.size
                                    ? `${selected.size} ${selected.size === 1 ? 'diária escolhida' : 'diárias escolhidas'} · faltam ${money(selectedTotal)} nelas.`
                                    : 'Sem escolher, o pagamento quita as diárias pendentes mais antigas primeiro.'}
                            </span>
                            <div className="pay-days">
                                {months.map(([ym, days]) => {
                                    const all = days.every((d) => selected.has(d.id));
                                    return (
                                        <div key={ym} className="pay-month">
                                            <label className="pay-month-head">
                                                <input type="checkbox" checked={all} onChange={(e) => changeSelection(days.map((d) => d.id), e.target.checked)} />
                                                <span>{monthLabel(ym)}</span>
                                                <span className="num muted">{money(days.reduce((acc, d) => acc + d.remaining, 0))}</span>
                                            </label>
                                            {days.map((d) => (
                                                <label key={d.id} className="pay-day">
                                                    <input type="checkbox" checked={selected.has(d.id)} onChange={(e) => changeSelection([d.id], e.target.checked)} />
                                                    <span>{shortDate(d.date, today)}</span>
                                                    {d.status === 'partial' && <span className="tag blue">Parcial</span>}
                                                    <span className="num">{money(d.remaining)}</span>
                                                </label>
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    ) : (
                        <div className="callout info"><Info size={16} /> Nenhuma diária pendente no momento.</div>
                    )}
                </div>

                {error && <div className="callout danger mt" role="alert">{error}</div>}
                <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
            </form>
        </Modal>
    );
}
