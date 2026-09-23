import {
    ArrowDownRight, ArrowUpRight, CalendarCheck, ChevronRight, Landmark, Sparkles, Wallet,
} from 'lucide-react';
import { useMemo } from 'react';
import { Topbar } from '../components/Topbar.jsx';
import { BalanceChart, CategoryBars, IncomeExpenseChart } from '../components/Charts.jsx';
import { Icon } from '../components/Icon.jsx';
import { TransactionRow } from '../components/TransactionForm.jsx';
import { AnimatedMoney, CategoryIcon, Delta, EmptyState } from '../components/ui.jsx';
import { addMonthsToMonth, clampedDate, lastMonths, monthLabel, monthOf, splitMonth } from '../lib/dates.js';
import { CATEGORY_IDS, DEFAULT_ACCOUNT_ID } from '../lib/defaults.js';
import {
    balanceSeries, cashBalance, dailyReceipt, defaultAccountId, expensesByCategory, forecastMonthEnd, isCredit, monthTotals,
    monthlyReceipt, monthlySeries, topExpenses, upcomingCommitments, workdayId,
} from '../lib/finance.js';
import { money, relativeDay } from '../lib/format.js';
import { buildInsights } from '../lib/insights.js';
import { remove, save } from '../lib/store.js';
import { navigate, useData, useSyncState, useUI } from '../state.jsx';

function Kpi({ label, icon: I, value, foot, hero = false }) {
    return (
        <div className={`card kpi${hero ? ' hero' : ''}`}>
            <span className="kpi-label"><I size={15} aria-hidden="true" /> {label}</span>
            <span className="kpi-value"><AnimatedMoney value={value} /></span>
            {foot && <span className="kpi-foot">{foot}</span>}
        </div>
    );
}

function DailyReceiptCard({ ym }) {
    const { transactions, profile, today, activeAccounts } = useData();
    const ui = useUI();
    const r = dailyReceipt(transactions, ym);
    const workedToday = transactions.some((t) => t.id === workdayId(today));
    const rate = Number(profile.dailyRate) || 0;

    async function toggleToday() {
        if (workedToday) {
            await remove('transactions', workdayId(today));
            ui.toast('Dia de hoje desmarcado.', 'info');
        } else {
            await save('transactions', {
                id: workdayId(today), type: 'income', amount: rate, description: 'Dia trabalhado', date: today,
                categoryId: CATEGORY_IDS.work, accountId: defaultAccountId({ accounts: activeAccounts, profile, type: 'income', preferredId: profile.workAccountId || DEFAULT_ACCOUNT_ID }), source: 'workday',
            });
            ui.toast(`Dia marcado: + ${money(rate)}`, 'success');
        }
    }

    return (
        <div className="card receipt">
            <div className="receipt-title">Recibo de {monthLabel(ym)}</div>
            <div className="receipt-row"><span>{r.days} {r.days === 1 ? 'dia' : 'dias'} × {money(rate)}</span><strong>{money(r.gross)}</strong></div>
            {r.otherIncome > 0 && <div className="receipt-row"><span>Outras receitas</span><strong>+ {money(r.otherIncome)}</strong></div>}
            <div className="receipt-row muted"><span>Gastos pessoais</span><strong>− {money(r.personal)}</strong></div>
            <div className="receipt-divider" />
            <div className="receipt-row total"><span>Saldo líquido</span><strong>{money(r.net)}</strong></div>
            {r.thirdParty > 0 && <div className="receipt-row muted"><span>Repassado a terceiros</span><strong>− {money(r.thirdParty)}</strong></div>}
            <div className="receipt-row total gold"><span>Saldo real (seu)</span><strong>{money(r.real)}</strong></div>
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

function InsightsCard({ insights }) {
    return (
        <div className="card">
            <div className="card-head">
                <Sparkles size={18} className="soft" aria-hidden="true" />
                <h2>Insights do Caderneta</h2>
            </div>
            {insights.length ? (
                <div className="insights">
                    {insights.slice(0, 4).map((i, idx) => (
                        <div key={i.id} className={`insight ${i.tone}`} style={{ animationDelay: `${idx * 60}ms` }}>
                            <span className="insight-icon"><Icon name={i.icon} size={16} /></span>
                            <span>{i.text}</span>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="soft small">Conforme você registrar lançamentos, o Caderneta compara meses, projeta seu saldo e avisa sobre contas chegando.</p>
            )}
        </div>
    );
}

export function Dashboard() {
    const data = useData();
    const ui = useUI();
    const sync = useSyncState();
    const { today, profile, accounts, transactions, recurrences, categories, categoryById } = data;
    const ym = monthOf(today);
    const prevYm = addMonthsToMonth(ym, -1);

    const view = useMemo(() => {
        const prev = splitMonth(prevYm);
        const prevPoint = clampedDate(prev.year, prev.month, Number(today.slice(8, 10)));
        const current = cashBalance(accounts, transactions, today);
        const month = monthTotals(transactions, ym, today);
        const monthPrev = monthTotals(transactions, prevYm, prevPoint);
        const forecast = forecastMonthEnd({ accounts, txs: transactions, recurrences, settings: profile, today });
        const available = forecast.current + forecast.scheduled + forecast.recurring - forecast.cardDue;
        const months = lastMonths(ym, 6);
        const byCat = [...expensesByCategory(transactions, ym)].map(([id, value]) => {
            const c = categoryById.get(id);
            return { id, value, name: c?.name || 'Sem categoria', color: c?.color || 8, icon: c?.icon };
        }).sort((a, b) => b.value - a.value);

        return {
            current,
            month,
            monthPrev,
            forecast,
            available,
            series: monthlySeries(transactions, months),
            balance: balanceSeries(accounts, transactions, months, today),
            byCat,
            catTotal: byCat.reduce((a, c) => a + c.value, 0),
            upcoming: upcomingCommitments({ accounts, txs: transactions, recurrences, today, days: 7 }),
            top: topExpenses(transactions, ym, 5, today),
            insights: buildInsights({
                accounts, categories, txs: transactions, recurrences, goals: data.goals,
                goalDeposits: data.goalDeposits, settings: profile, today,
            }),
            cashAccounts: accounts.filter((a) => !isCredit(a) && !a.archived).length,
        };
    }, [accounts, transactions, recurrences, categories, categoryById, profile, today, ym, prevYm, data.goals, data.goalDeposits]);

    const recent = transactions.filter((t) => t.date <= today).slice(0, 6);
    const firstName = sync.user?.name?.split(' ')[0];
    const isEmpty = transactions.length === 0;

    return (
        <div className="page">
            <Topbar eyebrow={`${monthLabel(ym)} · ${profile.mode === 'daily' ? 'Modo Diária' : 'Salário Mensal'}`} title={firstName ? `Olá, ${firstName}` : 'Seu painel'} />

            <section className="kpis" aria-label="Resumo do mês">
                <Kpi hero label="Saldo atual" icon={Wallet} value={view.current} foot={`em ${view.cashAccounts} ${view.cashAccounts === 1 ? 'conta' : 'contas'}`} />
                <Kpi
                    label="Receitas do mês"
                    icon={ArrowUpRight}
                    value={view.month.income}
                    foot={<><Delta current={view.month.income} previous={view.monthPrev.income} /> vs. mesmo ponto de {monthLabel(prevYm, { short: true })}</>}
                />
                <Kpi
                    label="Despesas do mês"
                    icon={ArrowDownRight}
                    value={view.month.expense}
                    foot={<><Delta current={view.month.expense} previous={view.monthPrev.expense} goodWhenUp={false} /> vs. mesmo ponto de {monthLabel(prevYm, { short: true })}</>}
                />
                <Kpi label="Disponível" icon={Landmark} value={view.available} foot="depois das contas do mês" />
            </section>

            {isEmpty && (
                <div className="card">
                    <EmptyState
                        icon="sparkles"
                        title="Seu caderno está em branco"
                        action={(
                            <div className="row wrap" style={{ justifyContent: 'center' }}>
                                <button className="btn btn-primary" onClick={() => ui.openTx()}>+ Primeiro lançamento</button>
                                {profile.mode === 'daily' && <a className="btn btn-secondary" href="#/calendario">Marcar dias trabalhados</a>}
                                <a className="btn btn-ghost" href="#/contas">Cadastrar contas</a>
                            </div>
                        )}
                    >
                        Registre um gasto, uma receita ou marque um dia trabalhado. Os gráficos, previsões e insights aparecem aqui conforme o caderno enche.
                    </EmptyState>
                </div>
            )}

            <div className="grid grid-2 grid-main">
                {profile.mode === 'daily' ? <DailyReceiptCard ym={ym} /> : <MonthlyReceiptCard ym={ym} />}
                <InsightsCard insights={view.insights} />
            </div>

            <div className="grid grid-2">
                <div className="card">
                    <div className="card-head">
                        <h2>Receitas × despesas</h2>
                        <a className="card-link" href="#/relatorios">Relatórios <ChevronRight size={15} /></a>
                    </div>
                    <IncomeExpenseChart data={view.series} />
                </div>
                <div className="card">
                    <div className="card-head">
                        <h2>Evolução do saldo</h2>
                        <span className="sub">Previsão: {money(view.forecast.end)}</span>
                    </div>
                    <BalanceChart data={view.balance} forecast={view.forecast.daysLeft > 0 ? view.forecast.end : null} />
                </div>
            </div>

            <div className="grid grid-3">
                <div className="card">
                    <div className="card-head">
                        <h2>Despesas por categoria</h2>
                        <a className="card-link" href="#/orcamento">Orçamento <ChevronRight size={15} /></a>
                    </div>
                    {view.byCat.length
                        ? <CategoryBars items={view.byCat} total={view.catTotal} onSelect={(c) => navigate('/lancamentos', { categoria: c.id, mes: ym })} />
                        : <EmptyState icon="chart" title="Sem despesas no mês">As categorias aparecem aqui assim que você registrar gastos.</EmptyState>}
                </div>

                <div className="card">
                    <div className="card-head">
                        <h2>Próximos 7 dias</h2>
                        <a className="card-link" href="#/recorrentes">Recorrentes <ChevronRight size={15} /></a>
                    </div>
                    {view.upcoming.length ? (
                        <div className="list">
                            {view.upcoming.slice(0, 6).map((i) => (
                                <div className="list-row" key={i.key}>
                                    <span className="cat-icon sm" style={{ '--c': i.kind === 'invoice' ? 'var(--series-7)' : i.type === 'income' ? 'var(--green)' : 'var(--gold)' }}>
                                        <Icon name={i.kind === 'invoice' ? 'card' : i.kind === 'installment' ? 'layers' : 'repeat'} size={15} />
                                    </span>
                                    <span className="list-main">
                                        <span className="list-title">{i.description}</span>
                                        <span className="list-sub">{relativeDay(i.date, today)}</span>
                                    </span>
                                    <span className={`list-amount ${i.type === 'income' ? 'pos' : ''}`}>{i.type === 'income' ? '+ ' : ''}{money(i.amount)}</span>
                                </div>
                            ))}
                        </div>
                    ) : <EmptyState icon="calendar" title="Nada agendado">Cadastre contas fixas como recorrentes para vê-las chegando.</EmptyState>}
                </div>

                <div className="card">
                    <div className="card-head"><h2>Maiores gastos do mês</h2></div>
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
                </div>
            </div>

            <div className="card">
                <div className="card-head">
                    <h2>Últimos lançamentos</h2>
                    <a className="card-link" href="#/lancamentos">Ver todos <ChevronRight size={15} /></a>
                </div>
                {recent.length
                    ? <div className="list">{recent.map((t) => <TransactionRow key={t.id} tx={t} showDate onClick={ui.openTx} />)}</div>
                    : <EmptyState title="Nenhum lançamento">Toque em + para registrar o primeiro.</EmptyState>}
            </div>
        </div>
    );
}
