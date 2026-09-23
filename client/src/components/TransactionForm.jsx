import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, Info, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { suggestCategory } from '../lib/categorize.js';
import { saveRecurrence } from '../lib/bootstrap.js';
import { FREQUENCIES, buildInstallments, defaultAccountId, isCredit, splitInstallments } from '../lib/finance.js';
import { CATEGORY_IDS } from '../lib/defaults.js';
import { money, parseAmount, round2 } from '../lib/format.js';
import { budgetAlertFor } from '../lib/notify.js';
import { newId, removeMany, save, saveMany } from '../lib/store.js';
import { db } from '../lib/db.js';
import { navigate, useData, useUI } from '../state.jsx';
import { CategoryIcon, Modal } from './ui.jsx';
import { seriesColor } from './Icon.jsx';

const TYPES = [
    { id: 'expense', label: 'Despesa', icon: ArrowDownRight },
    { id: 'income', label: 'Receita', icon: ArrowUpRight },
    { id: 'transfer', label: 'Transferência', icon: ArrowLeftRight },
];

export function TransactionForm({ initial, onClose }) {
    const data = useData();
    const ui = useUI();
    const editing = Boolean(initial?.id);
    const { today, activeAccounts, categories, transactions, recurrences } = data;

    const [type, setType] = useState(initial?.type || 'expense');
    const [amountText, setAmountText] = useState(initial?.amount ? String(initial.amount).replace('.', ',') : '');
    const [description, setDescription] = useState(initial?.description || '');
    const [date, setDate] = useState(initial?.date || today);
    const [categoryId, setCategoryId] = useState(initial?.categoryId || null);
    const [categoryTouched, setCategoryTouched] = useState(Boolean(initial?.categoryId));
    const [accountId, setAccountId] = useState(() => initial?.accountId
        || defaultAccountId({ accounts: activeAccounts, transactions, profile: data.profile, type: initial?.type || 'expense' }));
    const [toAccountId, setToAccountId] = useState(initial?.toAccountId || '');
    const [isThird, setIsThird] = useState(Boolean(initial?.person));
    const [person, setPerson] = useState(initial?.person || '');
    const [notes, setNotes] = useState(initial?.notes || '');
    const [mode, setMode] = useState('once'); // once | installments | repeat
    const [installments, setInstallments] = useState(2);
    const [frequency, setFrequency] = useState('monthly');
    const [error, setError] = useState('');

    const amount = parseAmount(amountText);
    const kind = type === 'income' ? 'income' : 'expense';
    const kindCategories = categories.filter((c) => c.kind === kind);
    const suggestion = useMemo(
        () => (type === 'transfer' ? null : suggestCategory(description, transactions, kind)),
        [description, transactions, kind, type],
    );
    const effectiveCategory = categoryTouched ? categoryId : (suggestion || categoryId);
    const recurrence = initial?.recurrenceId ? recurrences.find((r) => r.id === initial.recurrenceId) : null;
    const accountOptions = activeAccounts.filter((a) => type !== 'income' || !isCredit(a));
    const toAccount = data.accountById.get(toAccountId);
    const title = editing ? 'Editar lançamento' : 'Novo lançamento';

    function changeType(next) {
        setType(next);
        setError('');
        if (!categoryTouched || data.categoryById.get(categoryId)?.kind !== (next === 'income' ? 'income' : 'expense')) {
            setCategoryId(null);
            setCategoryTouched(false);
        }
        if (next === 'income' && isCredit(data.accountById.get(accountId))) {
            setAccountId(defaultAccountId({ accounts: activeAccounts, transactions, profile: data.profile, type: 'income' }));
        }
        if (next !== 'expense') setMode((m) => (m === 'installments' ? 'once' : m));
    }

    async function submit(e) {
        e?.preventDefault();
        if (!(amount > 0)) return setError('Informe um valor maior que zero.');
        if (!description.trim() && type !== 'transfer') return setError('Dê uma descrição ao lançamento.');
        if (!accountId) return setError('Escolha uma conta.');
        if (type === 'transfer' && (!toAccountId || toAccountId === accountId)) return setError('Escolha uma conta de destino diferente da origem.');
        if (isThird && !person.trim()) return setError('Informe o nome do terceiro.');
        if (mode === 'installments' && !(installments >= 2 && installments <= 72)) return setError('Parcelas: de 2 a 72.');

        const base = {
            type,
            amount: round2(amount),
            description: description.trim() || (isCredit(toAccount) ? `Pagamento da fatura ${toAccount.name}` : 'Transferência'),
            date,
            categoryId: type === 'transfer' ? null : effectiveCategory || (type === 'income' ? CATEGORY_IDS.otherIncome : CATEGORY_IDS.other),
            accountId,
            toAccountId: type === 'transfer' ? toAccountId : null,
            person: type === 'expense' && isThird ? person.trim() : '',
            notes: notes.trim(),
        };

        let created = [];
        if (editing) {
            created = [await save('transactions', { ...initial, ...base })];
            ui.toast('Lançamento atualizado.', 'success');
        } else if (mode === 'installments') {
            created = await saveMany('transactions', buildInstallments({
                ...base, groupId: newId('parc-'), totalAmount: base.amount, count: installments, firstDate: date,
            }));
            ui.toast(`${installments} parcelas criadas.`, 'success');
        } else if (mode === 'repeat') {
            const rec = await saveRecurrence({
                ...base,
                frequency,
                day: Number(date.slice(8, 10)),
                startDate: date,
            });
            ui.toast(`Recorrência ${FREQUENCIES[frequency].toLowerCase()} criada.`, 'success', {
                label: 'Ver', run: () => navigate('/recorrentes', { id: rec.id }),
            });
            created = [{ ...base }];
        } else {
            created = [await save('transactions', { ...base, source: 'manual' })];
            ui.toast('Lançamento salvo.', 'success');
        }

        if (type === 'expense' && base.categoryId) {
            const merged = [...transactions.filter((t) => !created.some((c) => c.id === t.id)), ...created];
            const alert = budgetAlertFor(categories, merged, base.categoryId, date.slice(0, 7));
            if (alert) {
                ui.toast(alert.level === 'over'
                    ? `Orçamento de ${alert.category.name} estourado: ${money(alert.spent)} de ${money(alert.limit)}.`
                    : `${alert.category.name}: ${Math.round(alert.ratio * 100)}% do orçamento usado.`, 'warn');
            }
        }
        onClose();
    }

    async function onDelete() {
        const inst = initial.installment;
        let ids = [initial.id];
        if (inst) {
            const siblings = transactions.filter((t) => t.installment?.groupId === inst.groupId);
            const choice = await ui.choose({
                title: 'Excluir parcela',
                message: `Esta é a parcela ${inst.index}/${inst.total} de "${initial.description}".`,
                options: [
                    { id: 'one', label: 'Só esta' },
                    { id: 'rest', label: 'Esta e as próximas', danger: true },
                ],
            });
            if (!choice) return;
            if (choice === 'rest') ids = siblings.filter((t) => t.installment.index >= inst.index).map((t) => t.id);
        } else if (!(await ui.confirm({ title: 'Excluir lançamento?', message: `"${initial.description}" — ${money(initial.amount)}`, confirmLabel: 'Excluir', danger: true }))) {
            return;
        }
        const snapshot = await db.transactions.bulkGet(ids);
        await removeMany('transactions', ids);
        onClose();
        ui.toast(ids.length > 1 ? `${ids.length} parcelas excluídas.` : 'Lançamento excluído.', 'info', {
            label: 'Desfazer',
            run: () => saveMany('transactions', snapshot.filter(Boolean)),
        });
    }

    return (
        <Modal
            title={title}
            onClose={onClose}
            footer={(
                <>
                    {editing && <button type="button" className="btn btn-danger" onClick={onDelete}>Excluir</button>}
                    <button type="submit" form="tx-form" className="btn btn-primary">{editing ? 'Salvar alterações' : 'Salvar lançamento'}</button>
                </>
            )}
        >
            <form id="tx-form" onSubmit={submit} noValidate>
                {!initial?.installment && initial?.source !== 'workday' && (
                    <div className="segmented" role="tablist" aria-label="Tipo de lançamento">
                        {TYPES.map((t) => (
                            <button
                                key={t.id}
                                type="button"
                                role="tab"
                                aria-selected={type === t.id}
                                className={`${type === t.id ? 'active' : ''} ${t.id}`}
                                onClick={() => changeType(t.id)}
                            >
                                <t.icon size={16} aria-hidden="true" /> {t.label}
                            </button>
                        ))}
                    </div>
                )}

                {initial?.installment && (
                    <div className="callout info mt"><Info size={16} /> Parcela {initial.installment.index} de {initial.installment.total} — alterações valem só para esta parcela.</div>
                )}
                {recurrence && (
                    <div className="callout info mt">
                        <Info size={16} />
                        <span>Gerado pela recorrência "{recurrence.description}". Alterar aqui muda só esta ocorrência. <a href={`#/recorrentes?id=${recurrence.id}`} onClick={onClose}>Editar recorrência</a></span>
                    </div>
                )}
                {initial?.source === 'workday' && (
                    <div className="callout info mt"><Info size={16} /> Dia trabalhado — para desmarcar, use o calendário.</div>
                )}

                <div className="field mt">
                    <label className="label" htmlFor="tx-amount">Valor{mode === 'installments' ? ' total' : ''}</label>
                    <div className="input-affix lg">
                        <input
                            id="tx-amount"
                            className="input input-lg"
                            inputMode="decimal"
                            placeholder="0,00"
                            value={amountText}
                            onChange={(e) => { setAmountText(e.target.value.replace(/[^\d.,]/g, '')); setError(''); }}
                            autoComplete="off"
                            data-autofocus
                        />
                        <span className="affix">R$</span>
                    </div>
                </div>

                <div className="field">
                    <label className="label" htmlFor="tx-desc">Descrição</label>
                    <input
                        id="tx-desc"
                        className="input"
                        placeholder={type === 'income' ? 'Ex.: salário, freela, venda…' : type === 'transfer' ? 'Opcional' : 'Ex.: mercado, aluguel, Uber…'}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        maxLength={120}
                        autoComplete="off"
                    />
                </div>

                {type !== 'transfer' && (
                    <div className="field">
                        <span className="label">Categoria</span>
                        <div className="chips" role="radiogroup" aria-label="Categoria">
                            {kindCategories.map((c) => {
                                const active = effectiveCategory === c.id;
                                const suggested = !categoryTouched && suggestion === c.id;
                                return (
                                    <button
                                        type="button"
                                        key={c.id}
                                        role="radio"
                                        aria-checked={active}
                                        className={`chip${active && !suggested ? ' active' : ''}${suggested ? ' suggested' : ''}`}
                                        onClick={() => { setCategoryId(active && categoryTouched ? null : c.id); setCategoryTouched(true); }}
                                    >
                                        {suggested ? <Sparkles size={13} aria-hidden="true" /> : <i className="dot" style={{ background: seriesColor(c.color) }} />}
                                        {c.name}
                                    </button>
                                );
                            })}
                        </div>
                        {!categoryTouched && suggestion && <span className="hint">Sugestão pela descrição — toque para confirmar ou escolha outra.</span>}
                    </div>
                )}

                <div className="field-row">
                    <div className="field">
                        <label className="label" htmlFor="tx-date">{mode === 'installments' ? '1ª parcela' : 'Data'}</label>
                        <input id="tx-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value || today)} required />
                    </div>
                    <div className="field">
                        <label className="label" htmlFor="tx-account">{type === 'transfer' ? 'De' : type === 'income' ? 'Entrou em' : 'Pago com'}</label>
                        <select id="tx-account" className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                            {accountOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                    </div>
                </div>

                {type === 'transfer' && (
                    <div className="field">
                        <label className="label" htmlFor="tx-to">Para</label>
                        <select id="tx-to" className="select" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                            <option value="">Escolha a conta de destino</option>
                            {activeAccounts.filter((a) => a.id !== accountId).map((a) => (
                                <option key={a.id} value={a.id}>{a.name}{isCredit(a) ? ' (pagar fatura)' : ''}</option>
                            ))}
                        </select>
                    </div>
                )}

                {type === 'expense' && (
                    <>
                        <label className="switch mt">
                            <span className="switch-text">
                                <strong>Repasse a terceiro</strong>
                                <span>Dinheiro que saiu por outra pessoa (conta no "saldo real").</span>
                            </span>
                            <input type="checkbox" checked={isThird} onChange={(e) => setIsThird(e.target.checked)} />
                        </label>
                        {isThird && (
                            <div className="field">
                                <label className="label" htmlFor="tx-person">Nome do terceiro</label>
                                <input id="tx-person" className="input" value={person} onChange={(e) => setPerson(e.target.value)} maxLength={80} />
                            </div>
                        )}
                    </>
                )}

                {!editing && (
                    <div className="field mt">
                        <span className="label">Frequência</span>
                        <div className="segmented">
                            <button type="button" className={mode === 'once' ? 'active' : ''} onClick={() => setMode('once')}>Única</button>
                            {type === 'expense' && (
                                <button type="button" className={mode === 'installments' ? 'active' : ''} onClick={() => setMode('installments')}>Parcelada</button>
                            )}
                            <button type="button" className={mode === 'repeat' ? 'active' : ''} onClick={() => setMode('repeat')}>Repete</button>
                        </div>
                        {mode === 'installments' && (
                            <div className="field-row mt">
                                <div className="field">
                                    <label className="label" htmlFor="tx-inst">Parcelas</label>
                                    <input id="tx-inst" type="number" min={2} max={72} className="input" value={installments} onChange={(e) => setInstallments(Number(e.target.value))} />
                                </div>
                                <div className="field">
                                    <span className="label">Cada parcela</span>
                                    <div className="input num" aria-live="polite" style={{ background: 'transparent' }}>
                                        {amount > 0 && installments >= 2 ? `${installments}x ${money(splitInstallments(amount, installments).at(-1))}` : '—'}
                                    </div>
                                </div>
                            </div>
                        )}
                        {mode === 'repeat' && (
                            <div className="field mt">
                                <select className="select" value={frequency} onChange={(e) => setFrequency(e.target.value)} aria-label="Repetir">
                                    {Object.entries(FREQUENCIES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                                </select>
                                <span className="hint">
                                    {frequency === 'monthly' && `Todo dia ${Number(date.slice(8, 10))}. `}
                                    Os próximos lançamentos serão gerados automaticamente.
                                </span>
                            </div>
                        )}
                    </div>
                )}

                <div className="field">
                    <label className="label" htmlFor="tx-notes">Observação <span className="muted">(opcional)</span></label>
                    <input id="tx-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
                </div>

                {error && <div className="callout danger mt" role="alert">{error}</div>}
                <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
            </form>
        </Modal>
    );
}

export function TransactionRow({ tx, onClick, showDate = false }) {
    const { categoryById, accountById, today } = useData();
    const category = categoryById.get(tx.categoryId);
    const account = accountById.get(tx.accountId);
    const to = accountById.get(tx.toAccountId);
    const future = tx.date > today;
    const sign = tx.type === 'income' ? '+ ' : tx.type === 'expense' ? '− ' : '';
    const cls = tx.type === 'income' ? 'pos' : tx.type === 'transfer' ? 'soft' : '';

    return (
        <button className="list-row" onClick={() => onClick?.(tx)}>
            {tx.type === 'transfer'
                ? <span className="cat-icon" style={{ '--c': 'var(--blue)' }} aria-hidden="true"><ArrowLeftRight size={18} /></span>
                : <CategoryIcon category={category} />}
            <span className="list-main">
                <span className="list-title">{tx.description}</span>
                <span className="list-sub">
                    {showDate && <span>{tx.date.split('-').reverse().slice(0, 2).join('/')}</span>}
                    {tx.type === 'transfer'
                        ? <span>{account?.name} → {to?.name}</span>
                        : <span>{category?.name || 'Sem categoria'}{account ? ` · ${account.name}` : ''}</span>}
                    {tx.person && <span className="tag gold">{tx.person}</span>}
                    {tx.installment && <span className="tag">{tx.installment.index}/{tx.installment.total}</span>}
                    {tx.source === 'recurrence' && <span className="tag blue">Recorrente</span>}
                    {future && <span className="tag">Agendado</span>}
                </span>
            </span>
            <span className={`list-amount ${cls}`}>{sign}{money(tx.amount)}</span>
        </button>
    );
}

