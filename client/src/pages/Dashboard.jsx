import {
    ArrowDownRight, ArrowUpRight, Briefcase, CalendarCheck, ChevronRight, Scale, Sparkles, Target, Wallet,
} from 'lucide-react';
import { useMemo } from 'react';
import { Topbar } from '../components/Topbar.jsx';
import { BalanceChart, CategoryBars, IncomeExpenseChart } from '../components/Charts.jsx';
import { Icon } from '../components/Icon.jsx';
import { TransactionRow } from '../components/TransactionForm.jsx';
import { AnimatedMoney, CategoryIcon, Delta, EmptyState } from '../components/ui.jsx';
import { addMonthsToMonth, clampedDate, lastMonths, monthLabel, monthOf, splitMonth } from '../lib/dates.js';
import { CATEGORY_IDS } from '../lib/defaults.js';
import {
    availableAfterPlan, balanceSeries, buildWorkday, cashBalance, expensesByCategory, forecastMonthEnd, isCredit, monthTotals,
    monthlyReceipt, monthlySeries, topExpenses, upcomingCommitments, workdayId, workdayMonth,
} from '../lib/finance.js';
import { money, relativeDay } from '../lib/format.js';
import { buildInsights } from '../lib/insights.js';
import { remove, save } from '../lib/store.js';
import { navigate, useData, useSyncState, useUI } from '../state.jsx';

function Kpi({ label, icon: I, value, foot, hero = false, href }) {
    const body = (
        <>
            <span className="kpi-label"><I size={15} aria-hidden="true" /> {label}</span>
            <span className="kpi-value"><AnimatedMoney value={value} /></span>
            {foot && <span className="kpi-foot">{foot}</span>}
        </>
    );
    return href
        ? <a className={`card kpi kpi-link${hero ? ' hero' : ''}`} href={href}>{body}</a>
        : <div className={`card kpi${hero ? ' hero' : ''}`}>{body}</div>;
}

/** Bloco secundário recolhível (fica aberto/fechado entre visitas). */
function Section({ id, title, children, defaultOpen = false }) {
    const key = `caderneta:dash:${id}`;
    let open = defaultOpen;
    try {
        const saved = localStorage.getItem(key);
        if (saved != null) open = saved === '1';
    } catch {
        // sem armazenamento
    }
    return (
        <details className="card fold" open={open} onToggle={(e) => { try { localStorage.setItem(key, e.currentTarget.open ? '1' : '0'); } catch { /* ignora */ } }}>
            <summary><h2>{title}</h2><ChevronRight size={18} className="fold-icon" aria-hidden="true" /></summary>
            <div className="fold-body">{children}</div>
        </details>
    );
}

function WorkMonthCard({ ym }) {
    const { profile, today, work, workdays } = useData();
    const ui = useUI();
    const m = workdayMonth(work, ym);
    const rate = Number(profile.dailyRate) || 0;
    const workedToday = workdays.some((w) => w.id === workdayId(today));

    async function toggleToday() {
        if (workedToday) {
            await remove('workdays', workdayId(today));
            ui.toast('Dia de hoje desmarcado.', 'info');
        } else {
            await save('workdays', buildWorkday(today, rate));
            ui.toast(`Dia marcado: ${money(rate)} a receber.`, 'success');
        }
    }

    return (
        <div className="card">
            <div className="card-head">
                <h2>Diárias de {monthLabel(ym).split(' ')[0].toLowerCase()}</h2>
                <a className="card-link" href="#/diarias">Calendário <ChevronRight size={15} /></a>
            </div>
            <table className="data-table summary-table">
                <tbody>
                    <tr><td>Dias trabalhados</td><td className="r num">{m.count}</td></tr>
                    <tr><td>Total trabalhado</td><td className="r num">{money(m.worked)}</td></tr>
                    <tr><td>Recebido pelas diárias</td><td className="r num pos">{money(m.paid)}</td></tr>
                    <tr className="total"><td>Pendente do mês</td><td className="r num">{money(m.remaining)}</td></tr>
                </tbody>
            </table>
            <button className={`btn btn-block mt ${workedToday ? 'btn-secondary' : 'btn-primary'}`} onClick={toggleToday}>
                <CalendarCheck size={17} /> {workedToday ? 'Hoje já está marcado — desmarcar' : 'Marcar hoje como trabalhado'}
            </button>
        </div>
    );
}

function MonthlyReceiptCard({ ym }) {
    const { transactions } = useData();
    const r = monthlyReceipt(transactions, ym, CATEGORY_IDS.salary);
    return (
        <div className="card receipt">
            <div className="receipt-title">Resumo de {monthLabel(ym)}</div>
            <div className="receipt-row"><span>Salário do mês</span><strong>{money(r.salary)}</strong></div>
            {r.otherIncome > 0 && <div className="receipt-row"><span>Outras receitas</span><strong>+ {money(r.otherIncome)}</strong></div>}
            <div className="receipt-row muted"><span>Total de gastos</span><strong>− {money(r.expenses)}</strong></div>
            {r.thirdParty > 0 && <div className="receipt-row muted"><span>… dos quais a terceiros</span><strong>{money(r.thirdParty)}</strong></div>}
            <div className="receipt-divider" />
            <div className="receipt-row total"><span>Saldo do mês</span><strong className={r.available < 0 ? 'neg' : ''}>{money(r.available)}</strong></div>
            {r.salary === 0 && <p className="hint center mt">O salário entra automaticamente no dia do pagamento.</p>}
        </div>
    );
}

export function Dashboard() {
    const data = useData();
    const ui = useUI();
    const sync = useSyncState();
    const { today, profile, accounts, transactions, recurrences, categories, categoryById, work, plan, workdays } = data;
    const ym = monthOf(today);
    const prevYm = addMonthsToMonth(ym, -1);
    const daily = profile.mode === 'daily' || workdays.length > 0;

    const view = useMemo(() => {
        const prev = splitMonth(prevYm);
        const prevPoint = clampedDate(prev.year, prev.month, Number(today.slice(8, 10)));
        const months = lastMonths(ym, 6);
        const byCat = [...expensesByCategory(transactions, ym)].map(([id, value]) => {
            const c = categoryById.get(id);
            return { id, value, name: c?.name || 'Sem categoria', color: c?.color || 8, icon: c?.icon };
        }).sort((a, b) => b.value - a.value);
        return {
            current: cashBalance(accounts, transactions, today),
            month: monthTotals(transactions, ym, today),
            monthPrev: monthTotals(transactions, prevYm, prevPoint),
            forecast: forecastMonthEnd({ accounts, txs: transactions, recurrences, today }),
            series: monthlySeries(transactions, months),
            balance: balanceSeries(accounts, transactions, months, today),
            byCat,
            catTotal: byCat.reduce((a, c) => a + c.value, 0),
            upcoming: upcomingCommitments({ accounts, txs: transactions, recurrences, today, days: 7, bills: plan.items }),
            top: topExpenses(transactions, ym, 5, today),
            insights: buildInsights({
                accounts, categories, txs: transactions, recurrences, goals: data.goals,
                goalDeposits: data.goalDeposits, settings: profile, today, workdays,
            }),
            cashAccounts: accounts.filter((a) => !isCredit(a) && !a.archived).length,
        };
    }, [accounts, transactions, recurrences, categories, categoryById, profile, today, ym, prevYm, data.goals, data.goalDeposits, plan, workdays]);

    const available = availableAfterPlan(view.current, plan.total);
    const recent = transactions.filter((t) => t.date <= today).slice(0, 6);
    const firstName = sync.user?.name?.split(' ')[0];
    const isEmpty = transactions.length === 0 && workdays.length === 0;

    return (
        <div className="page">
            <Topbar eyebrow={monthLabel(ym)} title={firstName ? `Olá, ${firstName}` : 'Seu dinheiro'} />

            <section className="kpis kpis-dash" aria-label="Resumo">
                <Kpi hero label="Saldo atual" icon={Wallet} value={view.current} foot={`em ${view.cashAccounts} ${view.cashAccounts === 1 ? 'conta' : 'contas'}`} href="#/contas" />
                <Kpi
                    label="Receitas do mês"
                    icon={ArrowUpRight}
                    value={view.month.income}
                    foot={<><Delta current={view.month.income} previous={view.monthPrev.income} /> vs. {monthLabel(prevYm, { short: true })}</>}
                    href="#/movimentacoes?tipo=income"
                />
                <Kpi
                    label="Despesas do mês"
                    icon={ArrowDownRight}
                    value={view.month.expense}
                    foot={<><Delta current={view.month.expense} previous={view.monthPrev.expense} goodWhenUp={false} /> vs. {monthLabel(prevYm, { short: true })}</>}
                    href="#/movimentacoes?tipo=expense"
                />
                {daily && <Kpi label="Diárias a receber" icon={Briefcase} value={work.totals.pending} foot={work.totals.pendingCount ? `${work.totals.pendingCount} ${work.totals.pendingCount === 1 ? 'diária' : 'diárias'} · fora do saldo` : 'tudo recebido'} href="#/diarias" />}
                <Kpi label="Contas planejadas" icon={Target} value={plan.total} foot={`${plan.count} ${plan.count === 1 ? 'conta' : 'contas'} a reservar`} href="#/planejamento" />
                <Kpi label="Disponível após planejamento" icon={Scale} value={available} foot={available < 0 ? 'falta para as contas' : 'saldo − planejado (estimativa)'} href="#/planejamento" />
            </section>

            {isEmpty && (
                <div className="card">
                    <EmptyState
                        icon="sparkles"
                        title="Seu caderno está em branco"
                        action={(
                            <div className="row wrap" style={{ justifyContent: 'center' }}>
                                <button className="btn btn-primary" onClick={() => ui.openTx()}>+ Primeira movimentação</button>
                                {daily && <a className="btn btn-secondary" href="#/diarias">Marcar dias trabalhados</a>}
                                <a className="btn btn-ghost" href="#/contas">Cadastrar contas</a>
                            </div>
                        )}
                    >
                        Registre uma receita, uma despesa ou marque um dia trabalhado.
                    </EmptyState>
                </div>
            )}

            <div className="grid grid-2 grid-main">
                <div className="card">
                    <div className="card-head">
                        <h2>Últimas movimentações</h2>
                        <a className="card-link" href="#/movimentacoes">Ver todas <ChevronRight size={15} /></a>
                    </div>
                    {recent.length
                        ? <div className="list">{recent.map((t) => <TransactionRow key={t.id} tx={t} showDate onClick={ui.openTx} />)}</div>
                        : <EmptyState title="Nenhuma movimentação">Toque em + para registrar a primeira.</EmptyState>}
                </div>
                {daily ? <WorkMonthCard ym={ym} /> : <MonthlyReceiptCard ym={ym} />}
            </div>

            <Section id="upcoming" title="Próximos 7 dias">
                {view.upcoming.length ? (
                    <div className="list">
                        {view.upcoming.slice(0, 8).map((i) => (
                            <div className="list-row" key={i.key}>
                                <span className="cat-icon sm" style={{ '--c': i.kind === 'invoice' ? 'var(--series-7)' : i.kind === 'bill' ? 'var(--gold)' : i.type === 'income' ? 'var(--green)' : 'var(--ink-muted)' }}>
                                    <Icon name={i.kind === 'invoice' ? 'card' : i.kind === 'installment' ? 'layers' : i.kind === 'bill' ? 'target' : 'repeat'} size={15} />
                                </span>
                                <span className="list-main">
                                    <span className="list-title">{i.description}</span>
                                    <span className="list-sub">{relativeDay(i.date, today)}{i.kind === 'bill' && <span className="tag gold">Planejado</span>}</span>
                                </span>
                                <span className={`list-amount ${i.type === 'income' ? 'pos' : ''}`}>{i.type === 'income' ? '+ ' : ''}{money(i.amount)}</span>
                            </div>
                        ))}
                    </div>
                ) : <EmptyState icon="calendar" title="Nada nos próximos dias">Contas planejadas, recorrências e faturas aparecem aqui.</EmptyState>}
            </Section>

            <Section id="charts" title="Gráficos do mês">
                <div className="grid grid-2">
                    <div>
                        <h3 className="label" style={{ marginBottom: 8 }}>Receitas × despesas</h3>
                        <IncomeExpenseChart data={view.series} />
                    </div>
                    <div>
                        <h3 className="label" style={{ marginBottom: 8 }}>Evolução do saldo · previsão {money(view.forecast.end)}</h3>
                        <BalanceChart data={view.balance} forecast={view.forecast.daysLeft > 0 ? view.forecast.end : null} />
                    </div>
                </div>
                <h3 className="label mt" style={{ marginBottom: 8 }}>Despesas por categoria</h3>
                {view.byCat.length
                    ? <CategoryBars items={view.byCat} total={view.catTotal} onSelect={(c) => navigate('/movimentacoes', { categoria: c.id, mes: ym, tipo: 'expense' })} />
                    : <EmptyState icon="chart" title="Sem despesas no mês" />}
            </Section>

            <Section id="top" title="Maiores gastos do mês">
                {view.top.length ? (
                    <div className="list">
                        {view.top.map((t, idx) => (
                            <button className="list-row" key={t.id} onClick={() => ui.openTx(t)}>
                                <span className="num muted" style={{ width: 16 }}>{idx + 1}</span>
                                <CategoryIcon category={categoryById.get(t.categoryId)} size="sm" />
                                <span className="list-main"><span className="list-title">{t.description}</span></span>
                                <span className="list-amount">{money(t.amount)}</span>
                            </button>
                        ))}
                    </div>
                ) : <EmptyState icon="receipt" title="Nenhum gasto ainda" />}
            </Section>

            <Section id="insights" title="Insights">
                {view.insights.length ? (
                    <div className="insights">
                        {view.insights.slice(0, 4).map((i) => (
                            <div key={i.id} className={`insight ${i.tone}`}>
                                <span className="insight-icon"><Icon name={i.icon} size={16} /></span>
                                <span>{i.text}</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="soft small"><Sparkles size={14} aria-hidden="true" /> Conforme você registrar movimentações, o Caderneta compara meses e avisa sobre contas chegando.</p>
                )}
            </Section>
        </div>
    );
}
