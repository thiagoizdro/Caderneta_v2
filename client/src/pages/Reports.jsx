import { Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Topbar } from '../components/Topbar.jsx';
import { BalanceChart, CategoryBars, IncomeExpenseChart } from '../components/Charts.jsx';
import { Delta, EmptyState, MonthPicker } from '../components/ui.jsx';
import { exportTransactionsCsv } from '../lib/backup.js';
import { addMonthsToMonth, lastMonths, monthLabel, monthOf } from '../lib/dates.js';
import { balanceSeries, dailyReceipt, expensesByCategory, monthTotals, monthlySeries } from '../lib/finance.js';
import { money } from '../lib/format.js';
import { navigate, useData } from '../state.jsx';

export function Reports() {
    const data = useData();
    const { transactions, accounts, categoryById, today, profile } = data;
    const [range, setRange] = useState(12);
    const [month, setMonth] = useState(monthOf(today));
    const prev = addMonthsToMonth(month, -1);

    const months = useMemo(() => lastMonths(monthOf(today), range), [today, range]);
    const series = useMemo(() => monthlySeries(transactions, months), [transactions, months]);
    const balance = useMemo(() => balanceSeries(accounts, transactions, months, today), [accounts, transactions, months, today]);

    const cats = useMemo(() => {
        const now = expensesByCategory(transactions, month);
        const before = expensesByCategory(transactions, prev);
        const ids = new Set([...now.keys(), ...before.keys()]);
        return [...ids].map((id) => {
            const c = categoryById.get(id);
            return { id, name: c?.name || 'Sem categoria', color: c?.color || 8, value: now.get(id) || 0, prev: before.get(id) || 0 };
        }).sort((a, b) => b.value - a.value);
    }, [transactions, month, prev, categoryById]);

    const nowT = monthTotals(transactions, month);
    const prevT = monthTotals(transactions, prev);
    const catTotal = cats.reduce((a, c) => a + c.value, 0);
    const avgExpense = series.reduce((a, s) => a + s.expense, 0) / (series.filter((s) => s.income || s.expense).length || 1);
    const savingsRate = series.reduce((a, s) => a + s.income, 0);
    const savings = savingsRate ? series.reduce((a, s) => a + s.net, 0) / savingsRate : 0;

    const compareRows = [
        { label: 'Receitas', now: nowT.income, prev: prevT.income, up: true },
        { label: 'Despesas', now: nowT.expense, prev: prevT.expense, up: false },
        { label: 'Resultado', now: nowT.net, prev: prevT.net, up: true },
    ];
    if (profile.mode === 'daily') {
        const a = dailyReceipt(transactions, month);
        const b = dailyReceipt(transactions, prev);
        compareRows.push({ label: 'Dias trabalhados', now: a.days, prev: b.days, up: true, plain: true });
        compareRows.push({ label: 'Repasses a terceiros', now: a.thirdParty, prev: b.thirdParty, up: false });
    }

    return (
        <div className="page">
            <Topbar eyebrow="Análises" title="Relatórios">
                <button className="btn-icon" onClick={() => exportTransactionsCsv(transactions, data)} aria-label="Exportar tudo em CSV" title="Exportar tudo em CSV"><Download size={19} /></button>
            </Topbar>

            <section className="kpis">
                <div className="card kpi"><span className="kpi-label">Gasto médio mensal</span><span className="kpi-value num">{money(avgExpense)}</span><span className="kpi-foot">últimos {range} meses</span></div>
                <div className="card kpi"><span className="kpi-label">Taxa de poupança</span><span className={`kpi-value num ${savings < 0 ? 'neg' : ''}`}>{Math.round(savings * 100)}%</span><span className="kpi-foot">do que entrou, sobrou</span></div>
                <div className="card kpi"><span className="kpi-label">Receitas no período</span><span className="kpi-value num">{money(series.reduce((a, s) => a + s.income, 0))}</span></div>
                <div className="card kpi"><span className="kpi-label">Despesas no período</span><span className="kpi-value num">{money(series.reduce((a, s) => a + s.expense, 0))}</span></div>
            </section>

            <div className="card">
                <div className="card-head">
                    <h2>Receitas × despesas</h2>
                    <div className="segmented" style={{ width: 200 }}>
                        {[6, 12].map((n) => <button key={n} className={range === n ? 'active' : ''} onClick={() => setRange(n)}>{n} meses</button>)}
                    </div>
                </div>
                <IncomeExpenseChart data={series} height={280} />
            </div>

            <div className="card">
                <div className="card-head"><h2>Evolução do saldo em contas</h2></div>
                <BalanceChart data={balance} height={240} />
            </div>

            <div className="toolbar"><MonthPicker value={month} onChange={setMonth} /></div>

            <div className="grid grid-2">
                <div className="card">
                    <div className="card-head"><h2>Despesas por categoria</h2><span className="sub">{monthLabel(month)}</span></div>
                    {catTotal > 0
                        ? <CategoryBars items={cats.filter((c) => c.value > 0)} total={catTotal} limit={10} onSelect={(c) => navigate('/lancamentos', { categoria: c.id, mes: month })} />
                        : <EmptyState icon="chart" title="Sem despesas neste mês" />}
                </div>

                <div className="card">
                    <div className="card-head"><h2>Comparação com {monthLabel(prev)}</h2></div>
                    <table className="data-table">
                        <thead><tr><th /><th className="r">{monthLabel(month, { short: true })}</th><th className="r">{monthLabel(prev, { short: true })}</th><th className="r">Var.</th></tr></thead>
                        <tbody>
                            {compareRows.map((r) => (
                                <tr key={r.label}>
                                    <td>{r.label}</td>
                                    <td className="r">{r.plain ? r.now : money(r.now)}</td>
                                    <td className="r">{r.plain ? r.prev : money(r.prev)}</td>
                                    <td className="r"><Delta current={r.now} previous={r.prev} goodWhenUp={r.up} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {cats.length > 0 && (
                        <>
                            <div className="label mt" style={{ marginBottom: 6 }}>Por categoria</div>
                            <div className="table-scroll">
                                <table className="data-table">
                                    <tbody>
                                        {cats.map((c) => (
                                            <tr key={c.id}>
                                                <td>{c.name}</td>
                                                <td className="r">{money(c.value)}</td>
                                                <td className="r muted">{money(c.prev)}</td>
                                                <td className="r"><Delta current={c.value} previous={c.prev} goodWhenUp={false} /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
