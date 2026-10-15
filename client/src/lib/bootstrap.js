// Rotinas de inicialização: registros padrão, geração das recorrências
// vencidas, migração automática dos dados do Caderneta 1.x e migração 3.0.

import { parseISODate, todayISO } from './dates.js';
import { COLLECTIONS, db, getMeta, setMeta } from './db.js';
import {
    CATEGORY_IDS, DEFAULT_ACCOUNTS, DEFAULT_ACCOUNT_ID, DEFAULT_CATEGORIES,
    PROFILE_ID, SALARY_RECURRENCE_ID, SEED_UPDATED_AT,
} from './defaults.js';
import { dueRecurrenceTxs, withScheduleChange } from './finance.js';
import { convertLegacy, readLegacyStorage } from './legacy.js';
import { planMigration, planRevert } from './migration.js';
import { putRows, save, saveMany } from './store.js';

const alive = (rows) => rows.filter((r) => !r.deleted);

export async function ensureDefaults() {
    if ((await db.categories.count()) === 0) {
        await saveMany('categories', DEFAULT_CATEGORIES, { updatedAt: SEED_UPDATED_AT });
    }
    if ((await db.accounts.count()) === 0) {
        await saveMany('accounts', DEFAULT_ACCOUNTS, { updatedAt: SEED_UPDATED_AT });
    }
}

/**
 * Cria os lançamentos de recorrências que já venceram. O updatedAt é a própria
 * data da ocorrência: assim, se o usuário editar ou excluir a ocorrência em
 * outro aparelho, a edição (mais nova) sempre vence a geração automática.
 */
export async function materializeRecurrences(today = todayISO()) {
    const recurrences = alive(await db.recurrences.toArray());
    if (!recurrences.length) return 0;
    const knownIds = new Set(await db.transactions.toCollection().primaryKeys());
    const due = dueRecurrenceTxs(recurrences, knownIds, today);
    for (const tx of due) {
        await save('transactions', tx, { updatedAt: parseISODate(tx.date).getTime() });
    }
    return due.length;
}

/** Salva uma recorrência protegendo o histórico quando o agendamento muda. */
export async function saveRecurrence(rec) {
    const prev = rec.id ? await db.recurrences.get(rec.id) : null;
    let lastGenerated = null;
    if (prev) {
        const generated = await db.transactions.where('recurrenceId').equals(rec.id).toArray();
        lastGenerated = generated.reduce((max, t) => (t.date > (max || '') ? t.date : max), null);
    }
    const saved = await save('recurrences', withScheduleChange(prev, rec, lastGenerated));
    await materializeRecurrences();
    return saved;
}

/** Salva o perfil e mantém a recorrência do salário coerente com ele. */
export async function saveProfile(profile) {
    const saved = await save('settings', { ...profile, id: PROFILE_ID });
    const current = await db.recurrences.get(SALARY_RECURRENCE_ID);
    const salary = Number(profile.monthlySalary) || 0;

    if (profile.mode === 'monthly' && salary > 0) {
        const startDate = current && !current.deleted ? current.startDate : `${todayISO().slice(0, 7)}-01`;
        await saveRecurrence({
            ...(current && !current.deleted ? current : {}),
            id: SALARY_RECURRENCE_ID,
            system: 'salary',
            type: 'income',
            description: 'Salário',
            amount: salary,
            frequency: 'monthly',
            day: Number(profile.payday) || 5,
            startDate,
            categoryId: CATEGORY_IDS.salary,
            accountId: profile.salaryAccountId || current?.accountId || DEFAULT_ACCOUNT_ID,
            paused: false,
        });
    } else if (current && !current.deleted && !current.paused) {
        await save('recurrences', { ...current, paused: true });
    }
    await materializeRecurrences();
    return saved;
}

/** Importa dados convertidos da v1 (do LocalStorage ou de um backup). */
export async function importLegacyData(raw) {
    const converted = convertLegacy(raw, { today: todayISO() });
    await ensureDefaults();
    await saveMany('transactions', converted.transactions);
    await saveMany('workdays', converted.workdays);
    await saveMany('recurrences', converted.recurrences);
    const existing = await db.settings.get(PROFILE_ID);
    if (!existing || existing.deleted || !existing.onboarded) {
        await save('settings', converted.settings[0]);
    }
    await materializeRecurrences();
    return converted;
}

/**
 * Migração automática: na primeira abertura da 2.x no mesmo endereço da 1.x,
 * os dados antigos do LocalStorage são convertidos. Os dados antigos não são
 * apagados — ficam como cópia de segurança.
 */
export async function migrateLegacyStorage() {
    if (await getMeta('legacyChecked')) return null;
    await setMeta('legacyChecked', true);
    let legacy = null;
    try {
        legacy = readLegacyStorage(window.localStorage);
    } catch {
        return null;
    }
    if (!legacy) return null;
    const converted = await importLegacyData(legacy);
    return { transactions: converted.transactions.length };
}

// ------------------------------------------------------------
// Migração 3.0: diárias fora das movimentações, planejamento de contas
// ------------------------------------------------------------

const REPORT_KEY = 'migration:v3:report';
const BACKUP_KEY = 'migration:v3:backup';

const MIGRATED_COLLECTIONS = ['transactions', 'workdays', 'bills', 'billPayments', 'accounts'];

async function readAll(collections) {
    const entries = await Promise.all(collections.map(async (c) => [c, await db.table(c).toArray()]));
    return Object.fromEntries(entries);
}

async function appendReport(run) {
    const report = (await getMeta(REPORT_KEY)) || { runs: [] };
    report.runs = [...report.runs, run].slice(-10);
    await setMeta(REPORT_KEY, report);
}

export function getMigrationReport() {
    return getMeta(REPORT_KEY);
}

export async function getMigrationBackup() {
    return getMeta(BACKUP_KEY);
}

/**
 * Aplica a migração 3.0 no que ainda não foi migrado. Antes da primeira
 * gravação guarda uma cópia completa do banco local. Se o saldo de qualquer
 * conta mudar no cálculo, nada é gravado e o relatório registra o motivo.
 * Seguro para rodar a cada abertura: registros já migrados são pulados.
 */
export async function runV3Migration() {
    const profile = await db.settings.get(PROFILE_ID);
    if (profile?.migrationV3 === 'reverted') return null;

    const plan = planMigration(await readAll(MIGRATED_COLLECTIONS));
    if (!plan.changes) return null;

    const run = { at: new Date().toISOString(), counts: plan.counts, balance: plan.balance, review: plan.review };
    if (!plan.balance.ok) {
        await appendReport({ ...run, aborted: true });
        return { ...run, aborted: true };
    }

    if (!(await getMeta(BACKUP_KEY))) {
        await setMeta(BACKUP_KEY, { createdAt: run.at, data: await readAll(COLLECTIONS) });
    }
    await putRows('workdays', plan.newWorkdays);
    await putRows('transactions', [...plan.txUpdates, ...plan.txDeletes.map((t) => ({ ...t, deleted: 1 }))]);
    await putRows('bills', plan.billUpdates);
    await appendReport(run);
    if (profile && !profile.deleted && profile.migrationV3 !== 'done') await save('settings', { ...profile, migrationV3: 'done' });
    return run;
}

/** Desfaz a migração 3.0 e impede que ela rode de novo sozinha. */
export async function revertV3Migration() {
    const plan = planRevert(await readAll(['transactions', 'workdays', 'bills']));
    await putRows('transactions', [...plan.txRestores, ...plan.txRevives]);
    await putRows('bills', plan.billRestores);
    await putRows('workdays', plan.workdayDeletes);
    const profile = await db.settings.get(PROFILE_ID);
    if (profile && !profile.deleted) await save('settings', { ...profile, migrationV3: 'reverted' });
    await appendReport({ at: new Date().toISOString(), reverted: true, counts: {
        transactionsRestored: plan.txRestores.length + plan.txRevives.length,
        billsRestored: plan.billRestores.length,
        workdaysRemoved: plan.workdayDeletes.length,
    } });
    return plan;
}

/** Volta a permitir a migração depois de um "desfazer" e a aplica. */
export async function reapplyV3Migration() {
    const profile = await db.settings.get(PROFILE_ID);
    if (profile && !profile.deleted) await save('settings', { ...profile, migrationV3: 'done' });
    return runV3Migration();
}
