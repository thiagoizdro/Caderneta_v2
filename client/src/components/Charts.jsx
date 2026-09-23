import { useState } from 'react';
import {
    Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { monthLabel } from '../lib/dates.js';
import { money, moneyCompact, percent } from '../lib/format.js';
import { seriesColor } from './Icon.jsx';

// Receitas × despesas usam os slots 1 (azul) e 2 (laranja) da paleta validada:
// verde × vermelho seria ilegível para quem tem daltonismo vermelho-verde.
const INCOME = 'var(--series-1)';
const EXPENSE = 'var(--series-2)';

const axisProps = {
    tickLine: false,
    axisLine: false,
    tick: { fill: 'var(--chart-axis)', fontSize: 11.5, fontFamily: 'var(--font-body)', fontWeight: 600 },
};

function TooltipBox({ title, rows }) {
    return (
        <div className="chart-tooltip">
            <div className="tt-title">{title}</div>
            {rows.map((r) => (
                <div className="tt-row" key={r.label}>
                    <span>{r.color && <i style={{ background: r.color }} />}{r.label}</span>
                    <b>{r.value}</b>
                </div>
            ))}
        </div>
    );
}

function TableToggle({ shown, onToggle }) {
    return (
        <button className="table-toggle" onClick={onToggle} aria-expanded={shown}>
            {shown ? 'Ver gráfico' : 'Ver tabela'}
        </button>
    );
}

export function IncomeExpenseChart({ data, height = 240 }) {
    const [table, setTable] = useState(false);
    return (
        <div>
            <div className="row between">
                <div className="chart-legend" aria-hidden={table}>
                    <span><i style={{ background: INCOME }} /> Receitas</span>
                    <span><i style={{ background: EXPENSE }} /> Despesas</span>
                </div>
                <TableToggle shown={table} onToggle={() => setTable(!table)} />
            </div>
            {table ? (
                <div className="table-scroll">
                    <table className="data-table">
                        <thead><tr><th>Mês</th><th className="r">Receitas</th><th className="r">Despesas</th><th className="r">Resultado</th></tr></thead>
                        <tbody>
                            {data.map((d) => (
                                <tr key={d.month}>
                                    <td>{monthLabel(d.month)}</td>
                                    <td className="r">{money(d.income)}</td>
                                    <td className="r">{money(d.expense)}</td>
                                    <td className={`r ${d.net < 0 ? 'neg' : ''}`}>{money(d.net)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="chart" style={{ height }} role="img" aria-label="Gráfico de receitas e despesas por mês">
                    <ResponsiveContainer>
                        <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                            <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m, { short: true })} {...axisProps} />
                            <YAxis tickFormatter={moneyCompact} width={62} {...axisProps} />
                            <Tooltip
                                cursor={{ fill: 'var(--bg-hover)' }}
                                content={({ active, payload, label }) => active && payload?.length ? (
                                    <TooltipBox
                                        title={monthLabel(label)}
                                        rows={[
                                            { label: 'Receitas', value: money(payload[0].payload.income), color: INCOME },
                                            { label: 'Despesas', value: money(payload[0].payload.expense), color: EXPENSE },
                                            { label: 'Resultado', value: money(payload[0].payload.net) },
                                        ]}
                                    />
                                ) : null}
                            />
                            <Bar dataKey="income" name="Receitas" fill={INCOME} radius={[4, 4, 0, 0]} maxBarSize={24} />
                            <Bar dataKey="expense" name="Despesas" fill={EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={24} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}

/** Evolução do saldo em contas; o último ponto pode ser a previsão do fim do mês. */
export function BalanceChart({ data, forecast, height = 220 }) {
    const [table, setTable] = useState(false);
    const points = data.map((d) => ({ ...d, label: monthLabel(d.month, { short: true }) }));
    if (forecast != null && points.length) {
        const last = points[points.length - 1];
        last.forecastLine = last.balance;
        points.push({ month: last.month, label: 'Previsão', forecast, forecastLine: forecast, isForecast: true });
    }
    const hasNegative = points.some((p) => p.balance < 0 || (p.forecast ?? 0) < 0);

    return (
        <div>
            <div className="row between">
                <div className="chart-legend">
                    <span><i className="line" style={{ background: 'var(--series-3)' }} /> Saldo no fim do mês</span>
                    {forecast != null && <span><i className="line" style={{ background: 'repeating-linear-gradient(90deg, var(--series-4) 0 4px, transparent 4px 7px)' }} /> Previsão</span>}
                </div>
                <TableToggle shown={table} onToggle={() => setTable(!table)} />
            </div>
            {table ? (
                <table className="data-table">
                    <thead><tr><th>Mês</th><th className="r">Saldo</th></tr></thead>
                    <tbody>
                        {data.map((d) => <tr key={d.month}><td>{monthLabel(d.month)}</td><td className="r">{money(d.balance)}</td></tr>)}
                        {forecast != null && <tr><td>Previsão fim do mês</td><td className="r">{money(forecast)}</td></tr>}
                    </tbody>
                </table>
            ) : (
                <div className="chart" style={{ height }} role="img" aria-label="Gráfico da evolução do saldo">
                    <ResponsiveContainer>
                        <AreaChart data={points} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="var(--series-3)" stopOpacity={0.16} />
                                    <stop offset="100%" stopColor="var(--series-3)" stopOpacity={0.02} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                            <XAxis dataKey="label" {...axisProps} />
                            <YAxis tickFormatter={moneyCompact} width={62} {...axisProps} />
                            {hasNegative && <ReferenceLine y={0} stroke="var(--line-strong)" />}
                            <Tooltip
                                cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
                                content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null;
                                    const p = payload[0].payload;
                                    if (p.isForecast) {
                                        return <TooltipBox title={`Fim de ${monthLabel(p.month)}`} rows={[{ label: 'Saldo previsto', value: money(p.forecast), color: 'var(--series-4)' }]} />;
                                    }
                                    return <TooltipBox title={monthLabel(p.month)} rows={[{ label: 'Saldo', value: money(p.balance), color: 'var(--series-3)' }]} />;
                                }}
                            />
                            <Area type="monotone" dataKey="balance" stroke="var(--series-3)" strokeWidth={2} fill="url(#balanceFill)"
                                dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--bg-card)', fill: 'var(--series-3)' }} />
                            {forecast != null && (
                                <Area type="linear" dataKey="forecastLine" stroke="var(--series-4)" strokeWidth={2} strokeDasharray="5 4" fill="none"
                                    dot={(props) => (props.payload.isForecast
                                        ? <circle key="fc" cx={props.cx} cy={props.cy} r={5} fill="var(--series-4)" stroke="var(--bg-card)" strokeWidth={2} />
                                        : <g key={props.index} />)}
                                    activeDot={false} isAnimationActive={false} />
                            )}
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}

/**
 * Despesas por categoria: barras horizontais em HTML, com rótulo e valor
 * sempre visíveis (três tons da paleta ficam abaixo de 3:1 no papel claro,
 * então a cor nunca carrega a informação sozinha).
 */
export function CategoryBars({ items, total, onSelect, limit = 7 }) {
    const [table, setTable] = useState(false);
    const shown = items.slice(0, limit);
    const rest = items.slice(limit);
    if (rest.length) {
        shown.push({ id: 'others', name: `Outras ${rest.length}`, color: 8, value: rest.reduce((a, i) => a + i.value, 0), icon: 'tag' });
    }
    const max = Math.max(...shown.map((i) => i.value), 1);

    return (
        <div>
            <div className="row between" style={{ marginBottom: 10 }}>
                <span className="small muted">Total {money(total)}</span>
                <TableToggle shown={table} onToggle={() => setTable(!table)} />
            </div>
            {table ? (
                <table className="data-table">
                    <thead><tr><th>Categoria</th><th className="r">Valor</th><th className="r">%</th></tr></thead>
                    <tbody>
                        {items.map((i) => <tr key={i.id}><td>{i.name}</td><td className="r">{money(i.value)}</td><td className="r">{percent(i.value / total)}</td></tr>)}
                    </tbody>
                </table>
            ) : (
                <div className="hbar">
                    {shown.map((i) => {
                        const clickable = onSelect && i.id !== 'others';
                        const Row = clickable ? 'button' : 'div';
                        return (
                            <Row key={i.id} className="hbar-row" onClick={clickable ? () => onSelect(i) : undefined} style={{ textAlign: 'left', width: '100%' }}>
                                <span className="hbar-label"><span>{i.name}</span></span>
                                <span className="hbar-value">{money(i.value)}<small>{percent(i.value / total)}</small></span>
                                <span className="hbar-track"><span style={{ width: `${(i.value / max) * 100}%`, '--c': seriesColor(i.color) }} /></span>
                            </Row>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
