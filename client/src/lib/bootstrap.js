// Rotinas de inicialização: registros padrão, geração das recorrências
// vencidas e migração automática dos dados do Caderneta 1.x.

import { parseISODate, todayISO } from './dates.js';
import { db, getMeta, setMeta } from './db.js';
import {
    CATEGORY_IDS, DEFAULT_ACCOUNTS, DEFAULT_ACCOUNT_ID, DEFAULT_CATEGORIES,
    PROFILE_ID, SALARY_RECURRENCE_ID, SEED_UPDATED_AT,
} from './defaults.js';
import { dueRecurrenceTxs, withScheduleChange } from './finance.js';
import { convertLegacy, readLegacyStorage } from './legacy.js';
import { save, saveMany } from './store.js';

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
