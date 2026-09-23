import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { suggestCategory } from '../src/lib/categorize.js';
import { addMonths, clampedDate, lastMonths } from '../src/lib/dates.js';
import { CATEGORY_IDS, DEFAULT_ACCOUNT_ID, SALARY_RECURRENCE_ID } from '../src/lib/defaults.js';
import { parseAmount } from '../src/lib/format.js';
import {
    accountBalances, budgetStatus, buildInstallments, cardSummary, cashBalance, dailyReceipt,
    dueRecurrenceTxs, forecastMonthEnd, goalProgress, installmentGroups, invoiceMonthFor,
    invoicePeriod, monthTotals, monthlyReceipt, recurrenceDates, splitInstallments, upcomingCommitments,
} from '../src/lib/finance.js';
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
    test('recibo da diária separa gastos pessoais e terceiros', () => {
        const txs = [
            tx('workday:2026-09-01', { type: 'income', amount: 150, date: '2026-09-01', source: 'workday' }),
            tx('workday:2026-09-02', { type: 'income', amount: 150, date: '2026-09-02', source: 'workday' }),
            tx('p', { type: 'expense', amount: 40, date: '2026-09-02' }),
            tx('3', { type: 'expense', amount: 60, date: '2026-09-02', person: 'João' }),
        ];
        assert.deepEqual(dailyReceipt(txs, '2026-09'), { days: 2, gross: 300, otherIncome: 0, personal: 40, thirdParty: 60, net: 260, real: 200 });
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
        const receipt = dailyReceipt(out.transactions, '2026-09');
        assert.deepEqual(receipt, { days: 2, gross: 300, otherIncome: 0, personal: 45.5, thirdParty: 100, net: 254.5, real: 154.5 });
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
