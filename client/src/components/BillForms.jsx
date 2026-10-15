import { useState } from 'react';
import { deleteBill, saveBill } from '../lib/bills.js';
import { money, parseAmount, round2 } from '../lib/format.js';
import { useData, useUI } from '../state.jsx';
import { Modal } from './ui.jsx';

const amountText = (v) => (v ? String(round2(v)).replace('.', ',') : '');

/** Valida os três campos de um item do planejamento. Devolve a mensagem de erro ou null. */
export function planItemError({ description, amount, dueDate }) {
    if (!description.trim()) return 'Dê um nome à conta.';
    if (!(amount > 0)) return 'Informe o valor.';
    if (!dueDate) return 'Informe o vencimento.';
    return null;
}

/** Edição de um item do planejamento: descrição, valor e vencimento. */
export function PlanItemForm({ bill, onClose }) {
    const ui = useUI();
    const { today } = useData();
    const editing = Boolean(bill?.id);
    const [description, setDescription] = useState(bill?.description || '');
    const [amount, setAmount] = useState(amountText(bill?.amount));
    const [dueDate, setDueDate] = useState(bill?.dueDate || today);
    const [error, setError] = useState('');

    async function submit(e) {
        e.preventDefault();
        const value = parseAmount(amount);
        const problem = planItemError({ description, amount: value, dueDate });
        if (problem) return setError(problem);
        await saveBill({ ...bill, description, amount: value, dueDate });
        ui.toast(editing ? 'Item atualizado. O saldo não muda.' : `${money(value)} adicionados ao planejamento.`, 'success');
        onClose();
    }

    async function onDelete() {
        const ok = await ui.confirm({
            title: `Excluir "${bill.description}"?`,
            message: 'O item sai do planejamento. Nenhuma movimentação é criada ou apagada.',
            confirmLabel: 'Excluir',
            danger: true,
        });
        if (!ok) return;
        const undo = await deleteBill(bill.id);
        onClose();
        ui.toast('Item excluído do planejamento.', 'info', { label: 'Desfazer', run: undo });
    }

    return (
        <Modal
            title={editing ? 'Editar item' : 'Novo item do planejamento'}
            onClose={onClose}
            footer={(
                <>
                    {editing && <button type="button" className="btn btn-danger" onClick={onDelete}>Excluir</button>}
                    <button type="submit" form="plan-form" className="btn btn-primary">Salvar</button>
                </>
            )}
        >
            <form id="plan-form" onSubmit={submit} noValidate>
                <div className="field">
                    <label className="label" htmlFor="plan-desc">Descrição</label>
                    <input id="plan-desc" className="input" value={description} onChange={(e) => { setDescription(e.target.value); setError(''); }} placeholder="Ex.: Faculdade, internet, aluguel" maxLength={60} data-autofocus />
                </div>
                <div className="field-row">
                    <div className="field">
                        <label className="label" htmlFor="plan-amount">Valor</label>
                        <div className="input-affix">
                            <input id="plan-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d.,]/g, '')); setError(''); }} placeholder="0,00" autoComplete="off" />
                            <span className="affix">R$</span>
                        </div>
                    </div>
                    <div className="field">
                        <label className="label" htmlFor="plan-due">Vencimento</label>
                        <input id="plan-due" type="date" className="input" value={dueDate} onChange={(e) => { setDueDate(e.target.value); setError(''); }} />
                    </div>
                </div>
                {error && <div className="callout danger mt" role="alert">{error}</div>}
                <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
            </form>
        </Modal>
    );
}
