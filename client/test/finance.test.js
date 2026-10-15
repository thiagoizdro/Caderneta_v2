import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { suggestCategory } from '../src/lib/categorize.js';
import { addMonths, clampedDate, lastMonths } from '../src/lib/dates.js';
import { CATEGORY_IDS, DEFAULT_ACCOUNT_ID, RECEIVABLE_ID, SALARY_RECURRENCE_ID } from '../src/lib/defaults.js';
import { parseAmount } from '../src/lib/format.js';
import {
    accountBalances, availableAfterPlan, budgetStatus, buildInstallments, buildWorkday, cardSummary, cashBalance,
    dueRecurrenceTxs, forecastMonthEnd, goalProgress, installmentGroups, invoiceMonthFor,
    invoicePeriod, monthTotals, monthlyReceipt, planSummary, recurrenceDates, splitInstallments, upcomingCommitments,
    workdayMonth, workdayShare, workdaySummary,
} from '../src/lib/finance.js';
import { MIGRATION_ID, planMigration, planRevert } from '../src/lib/migration.js';
import { buildInsights } from '../src/lib/insights.js';
import { convertLegacy, readLegacyStorage } from '../src/lib/legacy.js';

const wallet = { id: 'w', name: 'Carteira', type: 'wallet', initialBalance: 100 };
const bank = { id: 'b', name: 'Banco', type: 'checking', initialBalance: 1000 };
const card = { id: 'c', name: 'Cartão', type: 'credit', creditLimit: 2000, closingDay: 5, dueDay: 15 };

const tx = (id, fields) => ({ id, description: id, categoryId: CATEGORY_IDS.other, ...fields });

describe('datas', () => {
    test('limita o dia ao fim do mês', () => {
        assert.equal(clampedDate(2026, 2, 31), '2026-02-28');
        assert.equal(clampedDate(2028, 2, 31), '2028-02-29');
        assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
        assert.equal(addMonths('2026-01-31', 2, 31), '2026-03-31');
        assert.equal(addMonths('2026-11-10', 3), '2027-02-10');
    });

    test('lista meses em ordem', () => {
        assert.deepEqual(lastMonths('2026-02', 3), ['2025-12', '2026-01', '2026-02']);
    });

    test('lê valores digitados em formato brasileiro', () => {
        assert.equal(parseAmount('1.234,56'), 1234.56);
        assert.equal(parseAmount('12,5'), 12.5);
        assert.equal(parseAmount('R$ 30'), 30);
        assert.ok(Number.isNaN(parseAmount('')));
    });

});

describe('saldos', () => {
    const txs = [
        tx('i', { type: 'income', amount: 500, date: '2026-09-01', accountId: 'b' }),
        tx('e', { type: 'expense', amount: 30, date: '2026-09-02', accountId: 'w' }),
        tx('t', { type: 'transfer', amount: 200, date: '2026-09-03', accountId: 'b', toAccountId: 'w' }),
        tx('f', { type: 'expense', amount: 999, date: '2026-09-30', accountId: 'b' }),
        tx('cc', { type: 'expense', amount: 80, date: '2026-09-02', accountId: 'c' }),
    ];

    test('calcula por conta, respeitando a data', () => {
        const b = accountBalances([wallet, bank, card], txs, '2026-09-10');
        assert.equal(b.get('w'), 270);
        assert.equal(b.get('b'), 1300);
        assert.equal(b.get('c'), -80);
    });

    test('dinheiro em contas ignora cartão e lançamentos futuros', () => {
        assert.equal(cashBalance([wallet, bank, card], txs, '2026-09-10'), 1570);
        assert.equal(cashBalance([wallet, bank, card], txs, '2026-09-30'), 571);
    });

    test('totais do mês ignoram transferências', () => {
        assert.deepEqual(monthTotals(txs, '2026-09'), { income: 500, expense: 1109, net: -609 });
        assert.deepEqual(monthTotals(txs, '2026-09', '2026-09-10'), { income: 500, expense: 110, net: 390 });
    });
});

describe('modos Diária e Salário Mensal', () => {
    test('diárias do mês: dias e total trabalhado, sem virar receita', () => {
        const days = [buildWorkday('2026-09-01', 150), buildWorkday('2026-09-02', 150), buildWorkday('2026-08-31', 150)];
        const m = workdayMonth(workdaySummary(days, []), '2026-09');
        assert.equal(m.count, 2);
        assert.equal(m.worked, 300);
        assert.equal(workdayMonth(workdaySummary(days, []), '2026-07').count, 0);
    });

    test('resumo do salário mensal', () => {
        const txs = [
            tx('s', { type: 'income', amount: 3000, date: '2026-09-05', categoryId: CATEGORY_IDS.salary }),
            tx('x', { type: 'income', amount: 200, date: '2026-09-06' }),
            tx('e', { type: 'expense', amount: 1200, date: '2026-09-06' }),
        ];
        assert.equal(monthlyReceipt(txs, '2026-09', CATEGORY_IDS.salary).available, 2000);
    });
});

describe('cartão de crédito', () => {
    test('fatura pelo dia de fechamento', () => {
        assert.equal(invoiceMonthFor('2026-09-05', 5), '2026-09');
        assert.equal(invoiceMonthFor('2026-09-06', 5), '2026-10');
        assert.deepEqual(invoicePeriod('2026-09', 5, 15), { ym: '2026-09', start: '2026-08-06', closing: '2026-09-05', due: '2026-09-15' });
        // Vencimento antes do fechamento cai no mês seguinte.
        assert.equal(invoicePeriod('2026-09', 25, 3).due, '2026-10-03');
    });

    test('faturas, pagamentos e limite', () => {
        const txs = [
            tx('a', { type: 'expense', amount: 300, date: '2026-08-20', accountId: 'c' }),
            tx('b', { type: 'expense', amount: 100, date: '2026-09-02', accountId: 'c' }),
            tx('c', { type: 'expense', amount: 50, date: '2026-09-10', accountId: 'c' }),
            tx('pay', { type: 'transfer', amount: 250, date: '2026-09-12', accountId: 'b', toAccountId: 'c' }),
            ...buildInstallments({ groupId: 'nb', description: 'Notebook', totalAmount: 600, count: 3, firstDate: '2026-09-11', accountId: 'c' }),
        ];
        const s = cardSummary(card, txs, '2026-09-13');
        const sep = s.invoices.find((i) => i.ym === '2026-09');
        assert.equal(sep.amount, 400);
        assert.equal(sep.paid, 250);
        assert.equal(sep.remaining, 150);
        assert.equal(sep.status, 'closed');
        assert.equal(s.toPay.length, 1);
        assert.equal(s.current.ym, '2026-10');
        assert.equal(s.current.amount, 250); // 50 + 1ª parcela 200
        assert.equal(s.upcoming.length, 2);
        assert.equal(s.committed, 800); // 1050 comprado − 250 pago
        assert.equal(s.available, 1200);

        assert.equal(cardSummary(card, txs, '2026-09-16').toPay[0].status, 'overdue');
    });
});

describe('recorrências', () => {
    const internet = { id: 'net', type: 'expense', description: 'Internet', amount: 120, frequency: 'monthly', day: 10, startDate: '2026-07-01', accountId: 'b' };

    test('datas mensais, semanais e anuais', () => {
        assert.deepEqual(recurrenceDates(internet, '2026-07-01', '2026-09-30'), ['2026-07-10', '2026-08-10', '2026-09-10']);
        assert.deepEqual(recurrenceDates({ ...internet, day: 31, startDate: '2026-01-01' }, '2026-02-01', '2026-03-31'), ['2026-02-28', '2026-03-31']);
        assert.deepEqual(recurrenceDates({ frequency: 'weekly', startDate: '2026-09-01' }, '2026-09-05', '2026-09-20'), ['2026-09-08', '2026-09-15']);
        assert.deepEqual(recurrenceDates({ frequency: 'yearly', startDate: '2024-02-29' }, '2025-01-01', '2026-12-31'), ['2025-02-28', '2026-02-28']);
        assert.deepEqual(recurrenceDates({ ...internet, endDate: '2026-08-15' }, '2026-07-01', '2026-12-31'), ['2026-07-10', '2026-08-10']);
        assert.deepEqual(recurrenceDates({ ...internet, paused: true }, '2026-07-01', '2026-12-31'), []);
    });

    test('gera só o que venceu e não recria o que foi apagado', () => {
        const known = new Set(['net:2026-07-10']);
        const due = dueRecurrenceTxs([internet], known, '2026-09-10');
        assert.deepEqual(due.map((t) => t.id), ['net:2026-08-10', 'net:2026-09-10']);
        assert.equal(due[0].source, 'recurrence');
        assert.equal(due[0].amount, 120);
    });
});

describe('parcelamentos', () => {
    test('divide sem perder centavos', () => {
        const parts = splitInstallments(100, 3);
        assert.deepEqual(parts, [33.34, 33.33, 33.33]);
        assert.equal(parts.reduce((a, b) => a + b, 0).toFixed(2), '100.00');
    });

    test('Notebook R$ 3.600 em 12x de R$ 300', () => {
        const items = buildInstallments({ groupId: 'nb', description: 'Notebook', totalAmount: 3600, count: 12, firstDate: '2026-01-31' });
        assert.equal(items.length, 12);
        assert.equal(items[1].date, '2026-02-28');
        assert.equal(items[2].date, '2026-03-31');
        assert.equal(items[11].id, 'nb:12');

        const [g] = installmentGroups(items, '2026-03-31');
        assert.equal(g.paidCount, 3);
        assert.equal(g.installmentAmount, 300);
        assert.equal(g.remainingAmount, 2700);
        assert.equal(g.nextDate, '2026-04-30');
    });
});

describe('orçamento, previsão e metas', () => {
    const categories = [{ id: CATEGORY_IDS.food, name: 'Alimentação', kind: 'expense', budget: 800 }];

    test('orçamento por categoria', () => {
        const txs = [tx('a', { type: 'expense', amount: 630, date: '2026-09-02', categoryId: CATEGORY_IDS.food })];
        const [b] = budgetStatus(categories, txs, '2026-09');
        assert.equal(b.level, 'ok');
        assert.equal(Math.round(b.ratio * 100), 79);
        const [b2] = budgetStatus(categories, [...txs, tx('b', { type: 'expense', amount: 20, date: '2026-09-03', categoryId: CATEGORY_IDS.food })], '2026-09');
        assert.equal(b2.level, 'warn');
    });

    test('previsão de saldo no fim do mês', () => {
        const txs = [
            tx('e1', { type: 'expense', amount: 100, date: '2026-09-05', accountId: 'b' }),
            tx('e2', { type: 'expense', amount: 100, date: '2026-09-10', accountId: 'b' }),
            tx('future', { type: 'expense', amount: 50, date: '2026-09-25', accountId: 'b' }),
            tx('cc', { type: 'expense', amount: 300, date: '2026-09-01', accountId: 'c' }),
        ];
        const recurrences = [{ id: 'net', type: 'expense', amount: 120, frequency: 'monthly', day: 20, startDate: '2026-01-01', accountId: 'b', description: 'Internet' }];
        const f = forecastMonthEnd({ accounts: [bank, card], txs, recurrences, today: '2026-09-10' });
        assert.equal(f.current, 800);
        assert.equal(f.scheduled, -50);
        assert.equal(f.recurring, -120);
        assert.equal(f.cardDue, 300); // fatura fecha dia 5, vence dia 15
        assert.equal(f.variable, 400); // R$ 200 em 10 dias → R$ 20/dia × 20 dias
        assert.equal(f.end, -70);

        const next = upcomingCommitments({ accounts: [bank, card], txs, recurrences, today: '2026-09-10', days: 7 });
        assert.deepEqual(next.map((i) => i.kind), ['invoice']);
    });

    test('meta com previsão de conclusão', () => {
        const goal = { id: 'pc', name: 'PC novo', target: 5000 };
        const deposits = [
            { id: '1', goalId: 'pc', amount: 1000, date: '2026-06-23' },
            { id: '2', goalId: 'pc', amount: 1700, date: '2026-08-01' },
        ];
        const p = goalProgress(goal, deposits, '2026-09-23');
        assert.equal(p.saved, 2700);
        assert.equal(Math.round(p.ratio * 100), 54);
        assert.equal(p.remaining, 2300);
        assert.ok(p.monthlyAvg > 850 && p.monthlyAvg < 950);
        assert.equal(p.eta, '2026-12-23');
    });

    test('insights por regras', () => {
        const txs = [
            tx('a1', { type: 'expense', amount: 100, date: '2026-08-05', categoryId: CATEGORY_IDS.food, accountId: 'b' }),
            tx('a2', { type: 'expense', amount: 118, date: '2026-09-05', categoryId: CATEGORY_IDS.food, accountId: 'b' }),
        ];
        const insights = buildInsights({
            accounts: [bank], categories, txs, recurrences: [], goals: [], goalDeposits: [], settings: {}, today: '2026-09-10',
        });
        const texts = insights.map((i) => i.text).join('\n');
        assert.match(texts, /Alimentação aumentaram 18%/);
        assert.match(texts, /previsão de saldo para o dia 30/);
    });
});

describe('categorias e migração da v1', () => {
    test('sugere categoria por palavra-chave e histórico', () => {
        assert.equal(suggestCategory('Mercado do mês'), CATEGORY_IDS.food);
        assert.equal(suggestCategory('Uber pro centro'), CATEGORY_IDS.transport);
        assert.equal(suggestCategory('Netflix'), CATEGORY_IDS.subscriptions);
        assert.equal(suggestCategory('Pão'), CATEGORY_IDS.food);
        assert.equal(suggestCategory('coisa aleatória'), null);
        assert.equal(suggestCategory('Salário', [], 'expense'), null);
        assert.equal(suggestCategory('Salário', [], 'income'), CATEGORY_IDS.salary);
        const history = [{ description: 'Coisa aleatória', categoryId: CATEGORY_IDS.leisure, type: 'expense' }];
        assert.equal(suggestCategory('coisa aleatoria', history), CATEGORY_IDS.leisure);
    });

    test('converte o LocalStorage da v1 (modo Diária)', () => {
        const storage = new Map(Object.entries({
            config: JSON.stringify({ mode: 'daily', rate: 150 }),
            workedDays: JSON.stringify({ '2026-09-01': true, '2026-09-02': true }),
            transactions: JSON.stringify([
                { id: '1', description: 'Mercado', amount: 45.5, type: 'personal_discount', person: '', date: '2026-09-02T15:00:00.000Z' },
                { id: '2', description: 'Empréstimo', amount: '100', type: 'third_party', person: 'Maria', date: '2026-09-03T10:00:00.000Z' },
            ]),
        }));
        const legacy = readLegacyStorage({ getItem: (k) => storage.get(k) ?? null });
        const out = convertLegacy(legacy, { today: '2026-09-23' });

        assert.equal(out.settings[0].mode, 'daily');
        assert.equal(out.settings[0].dailyRate, 150);
        // Dias trabalhados viram diárias (fora do saldo), não receitas.
        assert.deepEqual(out.workdays.map((w) => [w.id, w.amount]), [['workday:2026-09-01', 150], ['workday:2026-09-02', 150]]);
        assert.equal(monthTotals(out.transactions, '2026-09').income, 0);
        assert.equal(monthTotals(out.transactions, '2026-09').expense, 145.5);
        assert.equal(out.transactions.find((t) => t.id === 'v1-1').categoryId, CATEGORY_IDS.food);
        assert.equal(out.transactions.find((t) => t.id === 'v1-2').person, 'Maria');
        assert.ok(out.transactions.every((t) => t.accountId === DEFAULT_ACCOUNT_ID));
    });

    test('converte backup da v1 (modo Salário Mensal)', () => {
        const backup = { app: 'Caderneta', dadosBrutos: { config: { mode: 'monthly', monthlySalary: 3000, referenceMonth: '2026-09' }, workedDays: {}, transactions: [] } };
        const out = convertLegacy(backup, { today: '2026-09-23' });
        assert.equal(out.recurrences[0].id, SALARY_RECURRENCE_ID);
        const due = dueRecurrenceTxs(out.recurrences, new Set(), '2026-09-23');
        assert.equal(due.length, 1);
        assert.equal(due[0].amount, 3000);
    });

    test('sem dados antigos não migra nada', () => {
        assert.equal(readLegacyStorage({ getItem: () => null }), null);
    });
});

describe('ajustes pós-revisão', () => {
    test('valores negativos usam o sinal tipográfico', async () => {
        const { money } = await import('../src/lib/format.js');
        assert.equal(money(-16.4), '− R$ 16,40');
        assert.equal(money(1234.5), 'R$ 1.234,50');
    });

    test('mudar o dia da recorrência não duplica meses já lançados', async () => {
        const { withScheduleChange } = await import('../src/lib/finance.js');
        const prev = { id: 'net', frequency: 'monthly', day: 10, startDate: '2026-07-01' };
        const next = withScheduleChange(prev, { ...prev, day: 15 }, '2026-09-10');
        assert.equal(next.activeFrom, '2026-09-11');
        assert.deepEqual(dueRecurrenceTxs([next], new Set(), '2026-10-20').map((t) => t.date), ['2026-09-15', '2026-10-15']);
        // Mudar só o valor não mexe no agendamento.
        assert.equal(withScheduleChange(prev, { ...prev, amount: 130 }, '2026-09-10').activeFrom, undefined);
    });

    test('conta padrão: última usada, depois a do perfil', async () => {
        const { defaultAccountId } = await import('../src/lib/finance.js');
        const accounts = [bank, wallet, card];
        assert.equal(defaultAccountId({ accounts, profile: { workAccountId: 'w' } }), 'w');
        const transactions = [{ type: 'expense', accountId: 'c' }];
        assert.equal(defaultAccountId({ accounts, transactions, profile: { workAccountId: 'w' } }), 'c');
        // Receita nunca vai para cartão.
        assert.equal(defaultAccountId({ accounts, transactions: [{ type: 'income', accountId: 'c' }], type: 'income' }), 'b');
    });
});

describe('insights de cartão', () => {
    test('várias faturas vencidas viram um único aviso por cartão', () => {
        const txs = [
            tx('j', { type: 'expense', amount: 120, date: '2026-07-10', accountId: 'c' }),
            tx('a', { type: 'expense', amount: 120, date: '2026-08-10', accountId: 'c' }),
        ];
        const insights = buildInsights({ accounts: [bank, card], categories: [], txs, recurrences: [], goals: [], goalDeposits: [], settings: {}, today: '2026-09-23' });
        const ids = insights.map((i) => i.id);
        assert.equal(new Set(ids).size, ids.length);
        assert.match(insights.find((i) => i.id === 'inv-late-c').text, /2 faturas do Cartão estão vencidas, somando R\$ 240,00/);
    });
});

describe('diárias separadas do dinheiro', () => {
    const eight = Array.from({ length: 8 }, (_, i) => buildWorkday(`2026-10-0${i + 1}`, 100));
    const income = (id, amount, date, fields = {}) => tx(id, { type: 'income', amount, date, accountId: 'b', categoryId: CATEGORY_IDS.work, ...fields });

    test('exemplo do escopo: 8 dias × R$ 100 = R$ 800 trabalhados, R$ 0 recebidos, R$ 800 pendentes', () => {
        const s = workdaySummary(eight, []);
        assert.equal(s.totals.count, 8);
        assert.equal(s.totals.worked, 800);
        assert.equal(s.totals.received, 0);
        assert.equal(s.totals.pending, 800);
    });

    test('marcar, editar ou desmarcar diárias não muda saldo nem receitas', () => {
        const txs = [tx('e', { type: 'expense', amount: 50, date: '2026-10-02', accountId: 'b' })];
        const before = { cash: cashBalance([wallet, bank], txs), month: monthTotals(txs, '2026-10') };
        // As diárias nem são transações: o saldo só enxerga `txs`.
        for (const days of [eight, eight.slice(0, 3), eight.map((d) => ({ ...d, amount: 120 })), []]) {
            workdaySummary(days, txs);
            assert.equal(cashBalance([wallet, bank], txs), before.cash);
            assert.deepEqual(monthTotals(txs, '2026-10'), before.month);
        }
    });

    test('exemplo do escopo: R$ 868 recebidos = UMA receita (R$ 800 de diárias + R$ 68 complementares)', () => {
        const pay = income('pix', 868, '2026-10-10', { workdayAmount: 800 });
        const s = workdaySummary(eight, [pay]);
        assert.equal(s.totals.received, 800);
        assert.equal(s.totals.extra, 68);
        assert.equal(s.totals.pending, 0);
        assert.ok(s.days.every((d) => d.status === 'paid'));
        // No dinheiro, entra uma vez só: R$ 868.
        assert.equal(monthTotals([pay], '2026-10').income, 868);
        assert.equal(cashBalance([bank], [pay]), 1000 + 868);
    });

    test('receita sem vínculo não conta como pagamento de diárias; vínculo nunca passa do valor', () => {
        assert.equal(workdayShare(income('x', 300, '2026-10-10')), 0);
        assert.equal(workdayShare(income('y', 300, '2026-10-10', { workdayAmount: 500 })), 300);
        assert.equal(workdayShare(tx('z', { type: 'expense', amount: 300, workdayAmount: 300, date: '2026-10-10' })), 0);
    });

    test('recebimento parcial cobre as diárias mais antigas primeiro, por mês', () => {
        const days = [buildWorkday('2026-09-30', 100), ...eight.slice(0, 3)];
        const s = workdaySummary(days, [income('p', 150, '2026-10-05', { workdayAmount: 150 })]);
        assert.deepEqual(s.days.map((d) => d.status), ['paid', 'partial', 'pending', 'pending']);
        assert.equal(workdayMonth(s, '2026-09').remaining, 0);
        assert.equal(workdayMonth(s, '2026-10').paid, 50);
        assert.equal(workdayMonth(s, '2026-10').remaining, 250);
        assert.equal(s.totals.pending, 250);
    });

    test('recebido além do trabalhado vira crédito, nunca pendente negativo', () => {
        const s = workdaySummary([buildWorkday('2026-10-01', 60)], [income('p', 100, '2026-10-05', { workdayAmount: 100 })]);
        assert.equal(s.totals.pending, 0);
        assert.equal(s.totals.credit, 40);
    });

    test('previsão de saldo não inclui diárias a receber', () => {
        const f = forecastMonthEnd({ accounts: [bank], txs: [], recurrences: [], settings: { mode: 'daily', dailyRate: 100 }, today: '2026-10-10' });
        assert.equal(f.end, 1000);
    });
});

describe('planejamento de contas', () => {
    const item = (id, description, amount, dueDate, fields = {}) => ({ id, description, amount, dueDate, ...fields });

    test('exemplo do escopo: Católica + UnB = R$ 867,01 necessários em outubro', () => {
        const p = planSummary([item('unb', 'UnB', 409.49, '2026-10-20'), item('cat', 'Católica', 457.52, '2026-10-13')]);
        assert.equal(p.total, 867.01);
        assert.deepEqual(p.items.map((b) => b.description), ['Católica', 'UnB']);
        assert.deepEqual(p.months.map((m) => [m.ym, m.total]), [['2026-10', 867.01]]);
    });

    test('exemplo do escopo: disponível após planejamento = saldo − planejado (R$ 1.200 − R$ 867,01)', () => {
        assert.equal(availableAfterPlan(1200, 867.01), 332.99);
    });

    test('adicionar R$ 500 ao planejamento só aumenta o total planejado', () => {
        const txs = [tx('e', { type: 'expense', amount: 80, date: '2026-10-02', accountId: 'b' })];
        const bills = [item('a', 'A', 100, '2026-10-20')];
        const before = { plan: planSummary(bills).total, cash: cashBalance([bank], txs), month: monthTotals(txs, '2026-10') };
        const after = planSummary([...bills, item('b', 'B', 500, '2026-10-25')]);
        assert.equal(after.total, before.plan + 500);
        assert.equal(cashBalance([bank], txs), before.cash);
        assert.deepEqual(monthTotals(txs, '2026-10'), before.month);
    });

    test('itens arquivados (contas quitadas antes da 3.0) ficam fora; vários meses ficam separados', () => {
        const p = planSummary([item('a', 'A', 100, '2026-10-20'), item('b', 'B', 50, '2026-11-05'), item('c', 'C', 999, '2026-10-01', { archived: true })]);
        assert.equal(p.total, 150);
        assert.deepEqual(p.months.map((m) => [m.ym, m.total]), [['2026-10', 100], ['2026-11', 50]]);
    });

    test('itens do planejamento aparecem nos próximos compromissos só como aviso', () => {
        const items = upcomingCommitments({ accounts: [bank], txs: [], recurrences: [], today: '2026-10-13', days: 7, bills: [item('net', 'Internet', 120, '2026-10-15'), item('fora', 'Fora', 1, '2026-12-01')] });
        assert.deepEqual(items.map((i) => [i.kind, i.description, i.amount]), [['bill', 'Internet', 120]]);
    });
});

describe('migração 3.0', () => {
    const accounts = [wallet, bank];
    const oldDay = (date, amount = 100, fields = {}) => ({
        id: `workday:${date}`, type: 'income', amount, description: 'Dia trabalhado', date, source: 'workday',
        categoryId: CATEGORY_IDS.work, accountId: RECEIVABLE_ID, updatedAt: 1000, ...fields,
    });
    const oldPay = (id, amount, date, fields = {}) => ({
        id, type: 'transfer', source: 'workpayment', amount, date, accountId: RECEIVABLE_ID, toAccountId: 'b',
        description: 'Pagamento de diárias', method: 'pix', workdayIds: [], updatedAt: 2000, ...fields,
    });
    const data = () => ({
        accounts,
        transactions: [
            oldDay('2026-09-01'), oldDay('2026-09-02'), oldDay('2026-09-03'),
            oldDay('2026-08-01', 150, { accountId: 'w' }), // antiga, direto na carteira
            oldPay('p1', 200, '2026-09-10'),
            tx('mercado', { type: 'expense', amount: 40, date: '2026-09-05', accountId: 'b', updatedAt: 1 }),
            tx('billpay:x', { type: 'expense', amount: 300, date: '2026-09-06', accountId: 'b', source: 'billpayment', updatedAt: 1 }),
            tx('manual', { type: 'income', amount: 200, date: '2026-09-10', accountId: 'w', source: 'manual', description: 'Pagamento empresa', updatedAt: 1 }),
        ],
        workdays: [],
        bills: [
            { id: 'quitada', description: 'Quitada', amount: 300, dueDate: '2026-09-20', updatedAt: 5 },
            { id: 'parcial', description: 'Parcial', amount: 800, dueDate: '2026-10-20', updatedAt: 5 },
            { id: 'nova', description: 'Nova', amount: 100, dueDate: '2026-10-25', updatedAt: 5 },
        ],
        billPayments: [{ id: 'x', billId: 'quitada', amount: 300 }, { id: 'y', billId: 'parcial', amount: 300 }],
    });

    const apply = (input, plan) => {
        const upd = new Map([...plan.txUpdates, ...plan.txDeletes.map((t) => ({ ...t, deleted: 1 }))].map((t) => [t.id, t]));
        const bills = new Map(plan.billUpdates.map((b) => [b.id, b]));
        return {
            ...input,
            transactions: input.transactions.map((t) => upd.get(t.id) || t),
            workdays: [...input.workdays, ...plan.newWorkdays],
            bills: input.bills.map((b) => bills.get(b.id) || b),
        };
    };
    const alive = (rows) => rows.filter((r) => !r.deleted);

    test('saldos de todas as contas iguais antes e depois', () => {
        const input = data();
        const plan = planMigration(input);
        assert.equal(plan.balance.ok, true);
        const after = apply(input, plan);
        assert.deepEqual(accountBalances(accounts, alive(after.transactions)), accountBalances(accounts, input.transactions));
    });

    test('diárias viram registros próprios; a receber sai das transações, pagamento vira receita real', () => {
        const input = data();
        const after = apply(input, planMigration(input));
        assert.deepEqual(after.workdays.map((w) => w.id).sort(), ['workday:2026-08-01', 'workday:2026-09-01', 'workday:2026-09-02', 'workday:2026-09-03']);
        const live = alive(after.transactions);
        assert.equal(live.filter((t) => t.source === 'workday').length, 0);
        const p1 = live.find((t) => t.id === 'p1');
        assert.equal(p1.type, 'income');
        assert.equal(p1.accountId, 'b');
        assert.equal(p1.workdayAmount, 200);
        // Receitas de setembro: só dinheiro real (pagamento 200 + receita manual 200), não as diárias.
        assert.equal(monthTotals(live, '2026-09').income, 400);
        // Despesa de conta paga continua lá.
        assert.ok(live.some((t) => t.id === 'billpay:x'));
        // Diárias: 450 trabalhados, 150 (antiga, já no saldo) + 200 recebidos.
        const s = workdaySummary(after.workdays, live);
        assert.equal(s.totals.worked, 450);
        assert.equal(s.totals.received, 350);
        assert.equal(s.totals.pending, 100);
    });

    test('planejamento: quitada sai, parcial fica com o que faltava, nada é apagado', () => {
        const input = data();
        const after = apply(input, planMigration(input));
        assert.equal(after.bills.length, 3);
        assert.equal(after.bills.find((b) => b.id === 'quitada').archived, true);
        assert.equal(after.bills.find((b) => b.id === 'parcial').amount, 500);
        assert.equal(planSummary(after.bills).total, 600);
    });

    test('relatório aponta diária antiga, contas e possível duplicação', () => {
        const plan = planMigration(data());
        const kinds = plan.review.map((r) => `${r.kind}:${r.id}`);
        assert.ok(kinds.includes('legacy-workday:workday:2026-08-01'));
        assert.ok(kinds.includes('possible-duplicate:manual'));
        assert.ok(kinds.includes('bill-paid:quitada'));
        assert.ok(kinds.includes('bill-partial:parcial'));
        assert.equal(plan.counts.paymentsConverted, 1);
        assert.equal(plan.counts.receivableWorkdaysRemoved, 3);
    });

    test('não roda duas vezes sobre os mesmos registros', () => {
        const input = data();
        const once = apply(input, planMigration(input));
        assert.equal(planMigration(once).changes, 0);
    });

    test('carimbo determinístico: anterior + 1 (edições reais feitas depois vencem)', () => {
        const plan = planMigration(data());
        assert.equal(plan.txUpdates.find((t) => t.id === 'p1').updatedAt, 2001);
        assert.equal(plan.newWorkdays.find((w) => w.id === 'workday:2026-09-01').updatedAt, 1001);
        assert.ok(plan.txUpdates.every((t) => t.migration.id === MIGRATION_ID));
    });

    test('é reversível: desfazer devolve os registros ao formato antigo', () => {
        const input = data();
        const after = apply(input, planMigration(input));
        const r = planRevert(after);
        const restored = new Map([...r.txRestores, ...r.txRevives].map((t) => [t.id, t]));
        const back = after.transactions.map((t) => restored.get(t.id) || t);
        for (const original of input.transactions) {
            const t = back.find((x) => x.id === original.id);
            const { updatedAt: _a, ...o } = original;
            const { updatedAt: _b, deleted, ...b } = t;
            assert.ok(!deleted, original.id);
            assert.deepEqual(b, o, original.id);
        }
        assert.equal(r.workdayDeletes.length, 4);
        const bills = new Map(r.billRestores.map((b) => [b.id, b]));
        assert.equal(bills.get('parcial').amount, 800);
        assert.equal(bills.get('quitada').archived, undefined);
    });

    test('desfazer e aplicar de novo recria os dias; dia desmarcado pelo usuário continua desmarcado', () => {
        const input = data();
        const after = apply(input, planMigration(input));
        const r = planRevert(after);
        const restored = new Map([...r.txRestores, ...r.txRevives].map((t) => [t.id, t]));
        const tomb = new Map(r.workdayDeletes.map((w) => [w.id, w]));
        const reverted = { ...after, transactions: after.transactions.map((t) => restored.get(t.id) || t), workdays: after.workdays.map((w) => tomb.get(w.id) || w) };
        const again = planMigration(reverted);
        assert.equal(again.newWorkdays.length, 4);
        assert.ok(again.newWorkdays.every((w) => w.updatedAt > tomb.get(w.id).updatedAt));
        const final = apply(reverted, again);
        const live = (rows) => new Map(rows.map((w) => [w.id, w]));
        assert.equal(workdaySummary([...live(final.workdays).values()].filter((w) => !w.deleted), alive(final.transactions)).totals.worked, 450);

        // Dia desmarcado pelo usuário (lápide sem "reverted") não volta.
        const unmarked = { ...data(), workdays: [{ id: 'workday:2026-09-01', date: '2026-09-01', amount: 100, deleted: 1, updatedAt: 5000 }] };
        assert.ok(!planMigration(unmarked).newWorkdays.some((w) => w.id === 'workday:2026-09-01'));
    });

    test('se o saldo mudasse, a validação acusa', () => {
        // Diária "a receber" apontando para uma conta real: removê-la mudaria o saldo.
        const input = { ...data(), transactions: [oldDay('2026-09-01', 100, { accountId: 'b', type: 'transfer' })] };
        const plan = planMigration(input);
        assert.equal(plan.balance.ok, false);
    });
});
