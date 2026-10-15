import { CalendarCheck, CalendarX, ChevronLeft, ChevronRight, HandCoins, Info, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Topbar } from '../components/Topbar.jsx';
import { TransactionRow } from '../components/TransactionForm.jsx';
import { EmptyState } from '../components/ui.jsx';
import {
    WEEKDAYS_SHORT, addMonthsToMonth, daysInMonth, makeDate, monthLabel, monthOf, splitMonth, startOfMonth,
} from '../lib/dates.js';
import { CATEGORY_IDS } from '../lib/defaults.js';
import { WORKDAY_STATUS, buildWorkday, workdayId, workdayMonth } from '../lib/finance.js';
import { capitalize, longDate, money, parseAmount, round2 } from '../lib/format.js';
import { remove, save } from '../lib/store.js';
import { useData, useUI } from '../state.jsx';

const STATUS_TAG = { pending: 'gold', partial: 'blue', paid: 'green' };
const QUICK_KEY = 'caderneta:quick-mark';

function readQuick() {
    try {
        return localStorage.getItem(QUICK_KEY) !== '0';
    } catch {
        return true;
    }
}

function writeQuick(on) {
    try {
        localStorage.setItem(QUICK_KEY, on ? '1' : '0');
    } catch {
        // sem armazenamento: vale só nesta sessão
    }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Edição do dia escolhido: marcar/desmarcar, valor da diária e observação. */
function DayPanel({ date, entry, rate, onToggle }) {
    const { today } = useData();
    const ui = useUI();
    const w = entry?.workday;
    const [amount, setAmount] = useState(w ? String(w.amount).replace('.', ',') : '');
    const [notes, setNotes] = useState(w?.notes || '');
    const future = date > today;

    async function saveDay(e) {
        e.preventDefault();
        const value = parseAmount(amount);
        if (!(value > 0)) return ui.toast('Informe o valor da diária.', 'error');
        await save('workdays', { ...w, amount: round2(value), notes: notes.trim() });
        ui.toast('Diária atualizada. O saldo não muda.', 'success');
    }

    return (
        <div className="card">
            <div className="card-head">
                <h2>{capitalize(longDate(date))}</h2>
                {entry && <span className={`tag ${STATUS_TAG[entry.status]}`}>{WORKDAY_STATUS[entry.status]}</span>}
            </div>
            <button
                className={`btn btn-block ${w ? 'btn-secondary' : 'btn-primary'}`}
                onClick={() => onToggle(date)}
                disabled={future}
            >
                {future ? <><CalendarX size={17} /> Dia ainda não chegou</>
                    : w ? <><CalendarX size={17} /> Desmarcar dia</>
                        : <><CalendarCheck size={17} /> Marcar como trabalhado ({money(rate)})</>}
            </button>
            {w && (
                <form className="mt" onSubmit={saveDay} key={w.id + w.updatedAt}>
                    <div className="field-row">
                        <div className="field">
                            <label className="label" htmlFor="wd-amount">Valor da diária</label>
                            <div className="input-affix">
                                <input id="wd-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} autoComplete="off" />
                                <span className="affix">R$</span>
                            </div>
                        </div>
                        <div className="field">
                            <label className="label" htmlFor="wd-notes">Observação</label>
                            <input id="wd-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={120} placeholder="Opcional" />
                        </div>
                    </div>
                    <button type="submit" className="btn btn-secondary btn-block mt">Salvar dia</button>
                </form>
            )}
        </div>
    );
}

export function Diarias() {
    const data = useData();
    const ui = useUI();
    const { today, profile, workdays, work } = data;
    const rate = Number(profile.dailyRate) || 0;
    const [month, setMonth] = useState(monthOf(today));
    const [selected, setSelected] = useState(today);
    const [quick, setQuick] = useState(readQuick);

    const byDate = useMemo(() => new Map(work.days.map((d) => [d.date, d])), [work]);
    const m = workdayMonth(work, month);
    const t = work.totals;

    const cells = useMemo(() => {
        const { year, month: mm } = splitMonth(month);
        const first = new Date(year, mm - 1, 1).getDay();
        const out = [];
        for (let i = 0; i < first; i++) out.push(null);
        for (let d = 1; d <= daysInMonth(year, mm); d++) out.push(makeDate(year, mm, d));
        return out;
    }, [month]);

    // Marcar/desmarcar nunca cria nem apaga movimentação: só o registro do dia.
    async function toggle(date) {
        if (date > today) return ui.toast('Não é possível marcar dias futuros.', 'error');
        if (byDate.has(date)) {
            await remove('workdays', workdayId(date));
            ui.toast('Dia desmarcado.', 'info');
        } else {
            if (!(rate > 0)) return ui.toast('Defina o valor da diária em Ajustes → Modo de controle.', 'warn');
            await save('workdays', buildWorkday(date, rate));
            ui.toast(`Dia marcado: ${money(rate)} a receber.`, 'success');
        }
    }

    function onDay(date) {
        setSelected(date);
        if (quick) toggle(date);
    }

    function go(delta) {
        const next = addMonthsToMonth(month, delta);
        setMonth(next);
        setSelected(next === monthOf(today) ? today : startOfMonth(next));
    }

    // Recebimento: uma receita real em Movimentações, com a parte das diárias informada.
    const receive = () => ui.openTx({
        type: 'income',
        categoryId: CATEGORY_IDS.work,
        description: 'Pagamento de diárias',
        amount: t.pending || undefined,
        workdayAmount: t.pending || undefined,
        accountId: profile.workAccountId || undefined,
    });

    if (!workdays.length && profile.mode !== 'daily') {
        return (
            <div className="page">
                <Topbar eyebrow="Modo Diária" title="Diárias" />
                <div className="card">
                    <EmptyState icon="briefcase" title="Disponível no modo Diária" action={<a className="btn btn-primary" href="#/ajustes?secao=modo">Ir para Ajustes</a>}>
                        Marque os dias trabalhados e acompanhe quanto ainda falta receber.
                    </EmptyState>
                </div>
            </div>
        );
    }

    const receipts = [...work.receipts].reverse().slice(0, 8);

    return (
        <div className="page">
            <Topbar eyebrow="Dias trabalhados" title="Diárias">
                <button className="btn btn-primary btn-sm" onClick={receive}><HandCoins size={16} /> Registrar recebimento</button>
            </Topbar>

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
                    <div className="cal-grid" role="grid" key={month}>
                        {cells.map((date, i) => {
                            if (!date) return <span key={`e${i}`} aria-hidden="true" />;
                            const d = byDate.get(date);
                            const cls = [
                                'cal-day',
                                date === today && 'today',
                                d && 'worked',
                                d && d.status !== 'paid' && 'unpaid',
                                selected === date && 'selected',
                                date > today && 'future',
                            ].filter(Boolean).join(' ');
                            const label = `${longDate(date)}${d ? `, trabalhado, ${WORKDAY_STATUS[d.status].toLowerCase()}` : ''}`;
                            return (
                                <button key={date} className={cls} onClick={() => onDay(date)} aria-label={label} aria-pressed={Boolean(d)}>
                                    <span>{Number(date.slice(8, 10))}</span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="cal-legend">
                        <span><i style={{ background: 'var(--green)' }} /> Trabalhado e recebido</span>
                        <span><i style={{ background: 'var(--green-wash)', border: '1.5px dashed var(--green)' }} /> A receber</span>
                        <span><i style={{ border: '2px solid var(--gold)' }} /> Hoje</span>
                    </div>
                    <label className="switch mt" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                        <span className="switch-text">
                            <strong>Marcação rápida</strong>
                            <span>Cada toque marca ou desmarca o dia.</span>
                        </span>
                        <input type="checkbox" checked={quick} onChange={(e) => { setQuick(e.target.checked); writeQuick(e.target.checked); }} />
                    </label>
                </div>

                <div className="stack" style={{ alignContent: 'start', gap: 18 }}>
                    <div className="card">
                        <div className="card-head"><h2>{capitalize(monthLabel(month))}</h2></div>
                        <table className="data-table summary-table">
                            <tbody>
                                <tr><td>Dias trabalhados</td><td className="r num">{m.count}</td></tr>
                                <tr><td>Valor por diária</td><td className="r num">{money(rate)}</td></tr>
                                <tr><td>Total trabalhado</td><td className="r num">{money(m.worked)}</td></tr>
                                <tr><td>Recebido pelas diárias</td><td className="r num pos">{money(m.paid)}</td></tr>
                                <tr className="total"><td>Pendente</td><td className="r num">{money(m.remaining)}</td></tr>
                            </tbody>
                        </table>
                        {round2(t.pending - m.remaining) > 0 && (
                            <p className="hint mt">Somando todos os meses, falta receber <b className="num">{money(t.pending)}</b> ({plural(t.pendingCount, 'diária', 'diárias')}).</p>
                        )}
                        <p className="hint mt">Diárias não entram no saldo. O dinheiro só conta quando você registra o recebimento.</p>
                    </div>

                    {selected.startsWith(month) && (
                        <DayPanel key={selected + (byDate.get(selected)?.workday.updatedAt || '')} date={selected} entry={byDate.get(selected)} rate={rate} onToggle={toggle} />
                    )}
                </div>
            </div>

            {t.credit > 0 && (
                <div className="callout">
                    <Info size={16} />
                    <span>Você registrou {money(t.credit)} recebidos além do total das diárias marcadas. Confira se algum dia trabalhado ficou sem marcar ou se a parte das diárias de algum recebimento está alta demais.</span>
                </div>
            )}

            <div className="card">
                <div className="card-head">
                    <h2>Recebimentos das diárias</h2>
                    <span className="sub">{money(t.received)}{t.extra > 0 ? ` + ${money(t.extra)} complementares` : ''}</span>
                </div>
                {receipts.length ? (
                    <div className="list">{receipts.map((tx) => <TransactionRow key={tx.id} tx={tx} showDate onClick={ui.openTx} />)}</div>
                ) : (
                    <EmptyState icon="coins" title="Nenhum recebimento ainda" action={<button className="btn btn-primary" onClick={receive}><Plus size={16} /> Registrar recebimento</button>}>
                        Quando a empresa pagar, registre uma receita e informe quanto dela é das diárias. Ela entra no saldo uma única vez.
                    </EmptyState>
                )}
                {work.receipts.length > receipts.length && <a className="card-link mt" href="#/movimentacoes?tipo=income">Ver todos em Movimentações</a>}
            </div>
        </div>
    );
}
