// Migração dos dados do Caderneta 1.x (LocalStorage: config, workedDays,
// transactions) ou de um backup JSON exportado por ele.

import { suggestCategory } from './categorize.js';
import { toISODate } from './dates.js';
import { CATEGORY_IDS, DEFAULT_ACCOUNT_ID, PROFILE_ID, SALARY_RECURRENCE_ID } from './defaults.js';
import { round2 } from './format.js';
import { workdayId } from './finance.js';

/** Lê o LocalStorage da versão antiga. Devolve null se não houver nada. */
export function readLegacyStorage(storage) {
    try {
        const config = JSON.parse(storage.getItem('config') || 'null');
        const workedDays = JSON.parse(storage.getItem('workedDays') || 'null');
        const transactions = JSON.parse(storage.getItem('transactions') || 'null');
        const hasData = (config && config.mode) || (workedDays && Object.keys(workedDays).length) || (transactions && transactions.length);
        return hasData ? { config: config || {}, workedDays: workedDays || {}, transactions: transactions || [] } : null;
    } catch {
        return null;
    }
}

/** Aceita tanto o backup da v1 ({ dadosBrutos: {...} }) quanto o formato cru. */
export function isLegacyBackup(data) {
    const source = data?.dadosBrutos || data;
    return Boolean(source && (source.config || source.workedDays || Array.isArray(source.transactions)) && !data.version);
}

function toLocalDate(value, fallback) {
    if (!value) return fallback;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? fallback : toISODate(d);
}

/**
 * Converte os dados da v1 em registros da v2:
 *  - dias trabalhados → receitas "Diárias" (um lançamento por dia, com a diária da época)
 *  - gasto pessoal → despesa, com categoria sugerida pela descrição
 *  - repasse a terceiro → despesa com o nome da pessoa (mantém o "saldo real")
 *  - salário mensal → recorrência de receita todo dia 5
 */
export function convertLegacy(raw, { today }) {
    const source = raw?.dadosBrutos || raw || {};
    const config = source.config || {};
    const workedDays = source.workedDays || {};
    const oldTxs = Array.isArray(source.transactions) ? source.transactions : [];
    const mode = config.mode === 'monthly' ? 'monthly' : 'daily';
    const rate = Number(config.rate) || 0;
    const salary = Number(config.monthlySalary) || 0;

    const settings = {
        id: PROFILE_ID,
        mode,
        dailyRate: rate,
        monthlySalary: salary,
        payday: 5,
        onboarded: true,
        migratedFromV1: today,
    };

    const transactions = [];

    for (const [date, worked] of Object.entries(workedDays)) {
        if (worked !== true || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        transactions.push({
            id: workdayId(date),
            type: 'income',
            amount: rate,
            description: 'Dia trabalhado',
            date,
            categoryId: CATEGORY_IDS.work,
            accountId: DEFAULT_ACCOUNT_ID,
            source: 'workday',
        });
    }

    for (const t of oldTxs) {
        const amount = round2(Number(t.amount));
        if (!(amount > 0)) continue;
        const description = String(t.description || 'Sem descrição').slice(0, 200);
        const isThird = t.type === 'third_party';
        transactions.push({
            id: `v1-${t.id || Math.random().toString(36).slice(2)}`,
            type: 'expense',
            amount,
            description,
            date: toLocalDate(t.date, today),
            categoryId: suggestCategory(description) || CATEGORY_IDS.other,
            accountId: DEFAULT_ACCOUNT_ID,
            person: isThird ? String(t.person || '').slice(0, 100) : '',
            source: 'legacy',
        });
    }

    const recurrences = [];
    if (mode === 'monthly' && salary > 0) {
        const month = /^\d{4}-\d{2}$/.test(config.referenceMonth || '') ? config.referenceMonth : today.slice(0, 7);
        recurrences.push({
            id: SALARY_RECURRENCE_ID,
            system: 'salary',
            type: 'income',
            description: 'Salário',
            amount: salary,
            frequency: 'monthly',
            day: 5,
            startDate: `${month}-01`,
            categoryId: CATEGORY_IDS.salary,
            accountId: DEFAULT_ACCOUNT_ID,
        });
    }

    return { settings: [settings], transactions, recurrences };
}
