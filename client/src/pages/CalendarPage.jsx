import { CalendarCheck, CalendarX, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Topbar } from '../components/Topbar.jsx';
import { TransactionRow } from '../components/TransactionForm.jsx';
import { EmptyState } from '../components/ui.jsx';
import {
    WEEKDAYS_SHORT, addMonthsToMonth, daysInMonth, endOfMonth, makeDate, monthLabel, monthOf, splitMonth, startOfMonth,
} from '../lib/dates.js';
import { CATEGORY_IDS, DEFAULT_ACCOUNT_ID } from '../lib/defaults.js';
import { dailyReceipt, defaultAccountId, monthTotals, pendingOccurrences, workdayId } from '../lib/finance.js';
import { capitalize, longDate, money, moneyCompact } from '../lib/format.js';
import { remove, save } from '../lib/store.js';
import { useData, useUI } from '../state.jsx';

export function CalendarPage() {
    const data = useData();
    const ui = useUI();
    const { today, profile, transactions, recurrences, knownTxIds, activeAccounts } = data;
    const isDaily = profile.mode === 'daily';
    const rate = Number(profile.dailyRate) || 0;

    const [month, setMonth] = useState(monthOf(today));
    const [selected, setSelected] = useState(today);
    const [quick, setQuick] = useState(false);
    const [slide, setSlide] = useState(0);

    const byDay = useMemo(() => {
        const map = new Map();
        const get = (d) => {
            if (!map.has(d)) map.set(d, { txs: [], planned: [], income: 0, expense: 0, worked: false });
            return map.get(d);
        };
        for (const t of transactions) {
            if (!t.date.startsWith(month)) continue;
            const d = get(t.date);
            d.txs.push(t);
            if (t.source === 'workday') d.worked = true;
            if (t.type === 'income') d.income += t.amount;
            if (t.type === 'expense') d.expense += t.amount;
        }
        const from = startOfMonth(month) > today ? startOfMonth(month) : today;
        for (const p of pendingOccurrences(recurrences, knownTxIds, from, endOfMonth(month))) {
            get(p.date).planned.push(p);
        }
        return map;
    }, [transactions, recurrences, knownTxIds, month, today]);

    const cells = useMemo(() => {
        const { year, month: m } = splitMonth(month);
        const first = new Date(year, m - 1, 1).getDay();
        const total = daysInMonth(year, m);
        const out = [];
        const prev = splitMonth(addMonthsToMonth(month, -1));
        const prevDays = daysInMonth(prev.year, prev.month);
        for (let i = first - 1; i >= 0; i--) out.push({ date: makeDate(prev.year, prev.month, prevDays - i), other: true });
        for (let d = 1; d <= total; d++) out.push({ date: makeDate(year, m, d) });
        const next = splitMonth(addMonthsToMonth(month, 1));
        for (let d = 1; out.length % 7; d++) out.push({ date: makeDate(next.year, next.month, d), other: true });
        return out;
    }, [month]);

    function go(delta) {
        setSlide(delta);
        setMonth((m) => addMonthsToMonth(m, delta));
    }

    async function toggleWorked(date) {
        if (date > today) {
            ui.toast('Não é possível marcar dias futuros.', 'error');
            return;
        }
        const id = workdayId(date);
        if (transactions.some((t) => t.id === id)) {
            await remove('transactions', id);
            if (!quick) ui.toast('Dia desmarcado.', 'info');
        } else {
            await save('transactions', {
                id, type: 'income', amount: rate, description: 'Dia trabalhado', date, source: 'workday',
                categoryId: CATEGORY_IDS.work,
                accountId: defaultAccountId({ accounts: activeAccounts, profile, type: 'income', preferredId: profile.workAccountId || DEFAULT_ACCOUNT_ID }),
            });
            if (!quick) ui.toast(`Dia marcado: + ${money(rate)}`, 'success');
        }
    }

    function onDayClick(cell) {
        if (cell.other) {
            go(cell.date < startOfMonth(month) ? -1 : 1);
            setSelected(cell.date);
            return;
        }
        if (quick && isDaily) toggleWorked(cell.date);
        else setSelected(cell.date);
    }

    const sel = byDay.get(selected) || { txs: [], planned: [], worked: false };
    const receipt = dailyReceipt(transactions, month);
    const totals = monthTotals(transactions, month);
    const selectedInMonth = selected.startsWith(month);

    return (
        <div className="page">
            <Topbar eyebrow={isDaily ? 'Cartão de ponto' : 'Calendário financeiro'} title="Calendário" />

            <div className="grid grid-2 grid-main">
                <div className="card">
                    <div className="cal-head">
                        <button className="btn-icon" onClick={() => go(-1)} aria-label="Mês anterior"><ChevronLeft size={20} /></button>
                        <h2 aria-live="polite">{monthLabel(month)}</h2>
                        <button className="btn-icon" onClick={() => go(1)} aria-label="Próximo mês"><ChevronRight size={20} /></button>
                    </div>
                    <div className="cal-weekdays" aria-hidden="true">
                        {WEEKDAYS_SHORT.map((d, i) => <span key={i}>{d}</span>)}
                    </div>
                    <div className="cal-grid" key={month} style={{ animation: slide ? `fadeUp 0.3s var(--ease-out)` : undefined }} role="grid">
                        {cells.map((cell) => {
                            const info = byDay.get(cell.date);
                            const day = Number(cell.date.slice(8, 10));
                            const cls = [
                                'cal-day',
                                cell.other && 'other',
                                cell.date === today && 'today',
                                !cell.other && info?.worked && 'worked',
                                !cell.other && selected === cell.date && !quick && 'selected',
                            ].filter(Boolean).join(' ');
                            const labelParts = [longDate(cell.date)];
                            if (info?.worked) labelParts.push('trabalhado');
                            if (info?.expense) labelParts.push(`gastos ${money(info.expense)}`);
                            if (info?.planned.length) labelParts.push(`${info.planned.length} previsto(s)`);
                            return (
                                <button key={cell.date} className={cls} onClick={() => onDayClick(cell)} aria-label={labelParts.join(', ')} aria-pressed={selected === cell.date}>
                                    <span>{day}</span>
                                    {!cell.other && info && (
                                        <>
                                            {info.expense > 0 && <span className="cal-amt">−{moneyCompact(info.expense).replace('R$ ', '')}</span>}
                                            <span className="cal-dots" aria-hidden="true">
                                                {info.income > 0 && !info.worked && <i className="in" />}
                                                {info.expense > 0 && <i />}
                                                {info.planned.length > 0 && <i className="plan" />}
                                            </span>
                                        </>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    <div className="cal-legend">
                        {isDaily && <span><i style={{ background: 'var(--green)' }} /> Trabalhado</span>}
                        <span><i style={{ border: '2px solid var(--gold)' }} /> Hoje</span>
                        <span><i style={{ background: 'var(--red)', borderRadius: '50%' }} /> Gastos</span>
                        <span><i style={{ border: '1.5px solid var(--gold)', borderRadius: '50%' }} /> Previsto</span>
                    </div>
                    {isDaily && (
                        <label className="switch mt" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                            <span className="switch-text">
                                <strong>Marcação rápida</strong>
                                <span>Cada toque marca ou desmarca o dia como trabalhado.</span>
                            </span>
                            <input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} />
                        </label>
                    )}
                </div>

                <div className="stack" style={{ alignContent: 'start', gap: 18 }}>
                    <div className="card">
                        <div className="receipt-title" style={{ textAlign: 'left', margin: '0 0 8px' }}>{monthLabel(month)}</div>
                        {isDaily && (
                            <>
                                <div className="receipt-row"><span>Dias trabalhados</span><strong>{receipt.days}</strong></div>
                                <div className="receipt-row"><span>Total bruto</span><strong>{money(receipt.gross)}</strong></div>
                            </>
                        )}
                        <div className="receipt-row"><span>Receitas</span><strong className="pos">{money(totals.income)}</strong></div>
                        <div className="receipt-row"><span>Despesas</span><strong>{money(totals.expense)}</strong></div>
                        <div className="receipt-divider" />
                        <div className="receipt-row total"><span>Resultado</span><strong className={totals.net < 0 ? 'neg' : ''}>{money(totals.net)}</strong></div>
                    </div>

                    {selectedInMonth && (
                        <div className="card">
                            <div className="card-head">
                                <h2>{capitalize(longDate(selected))}</h2>
                                <button className="btn btn-secondary btn-sm" onClick={() => ui.openTx({ date: selected })}><Plus size={15} /> Lançar</button>
                            </div>
                            {isDaily && (
                                <button
                                    className={`btn btn-block ${sel.worked ? 'btn-secondary' : 'btn-primary'}`}
                                    onClick={() => toggleWorked(selected)}
                                    disabled={selected > today}
                                    style={{ marginBottom: 12 }}
                                >
                                    {selected > today ? <><CalendarX size={17} /> Dia ainda não chegou</>
                                        : sel.worked ? <><CalendarX size={17} /> Desmarcar dia</>
                                            : <><CalendarCheck size={17} /> Marcar como trabalhado (+ {money(rate)})</>}
                                </button>
                            )}
                            {sel.txs.length || sel.planned.length ? (
                                <div className="list">
                                    {sel.txs.map((t) => <TransactionRow key={t.id} tx={t} onClick={ui.openTx} />)}
                                    {sel.planned.map((p) => (
                                        <div className="list-row" key={p.tx.id} style={{ opacity: 0.75 }}>
                                            <span className="cat-icon" style={{ '--c': 'var(--gold)' }}><CalendarCheck size={18} /></span>
                                            <span className="list-main">
                                                <span className="list-title">{p.rec.description}</span>
                                                <span className="list-sub"><span className="tag gold">Previsto</span> recorrência</span>
                                            </span>
                                            <span className={`list-amount ${p.rec.type === 'income' ? 'pos' : ''}`}>{money(p.rec.amount)}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : <EmptyState icon="calendar" title="Dia sem lançamentos" />}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
