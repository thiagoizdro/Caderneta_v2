import { COLLECTIONS, META_FIELDS, db } from './db.js';
import { importLegacyData } from './bootstrap.js';
import { isLegacyBackup } from './legacy.js';
import { saveMany } from './store.js';

export const BACKUP_VERSION = 2;

function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

/** Registros vivos sem os campos de controle (formato do backup). */
function cleanRows(rows) {
    return rows
        .filter((r) => !r.deleted)
        .map((r) => {
            const clean = { ...r };
            META_FIELDS.filter((f) => f !== 'id').forEach((f) => delete clean[f]);
            return clean;
        });
}

export async function exportBackup() {
    const data = {};
    for (const collection of COLLECTIONS) data[collection] = cleanRows(await db.table(collection).toArray());
    const payload = { app: 'Caderneta', version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
    download(`caderneta_backup_${stamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

/**
 * Cópia guardada antes da migração 3.0. `data` pode ser restaurado em
 * "Restaurar backup"; `raw` traz tudo, inclusive registros excluídos.
 */
export function exportMigrationBackup(backup) {
    const data = {};
    for (const [collection, rows] of Object.entries(backup.data)) data[collection] = cleanRows(rows);
    const payload = { app: 'Caderneta', version: BACKUP_VERSION, exportedAt: backup.createdAt, note: 'Cópia de antes da atualização 3.0', data, raw: backup.data };
    download(`caderneta_antes_da_3.0_${backup.createdAt.slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

const csvCell = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV com ponto e vírgula e vírgula decimal: abre direto no Excel/Sheets em português. */
export function exportTransactionsCsv(transactions, { categories, accounts }) {
    const cat = new Map(categories.map((c) => [c.id, c.name]));
    const acc = new Map(accounts.map((a) => [a.id, a.name]));
    const types = { income: 'Receita', expense: 'Despesa', transfer: 'Transferência' };
    const header = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Conta', 'Conta destino', 'Terceiro', 'Valor', 'Parcela', 'Parte diárias'];
    const rows = [...transactions]
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((t) => [
            t.date.split('-').reverse().join('/'),
            types[t.type] || t.type,
            t.description,
            cat.get(t.categoryId) || '',
            acc.get(t.accountId) || '',
            acc.get(t.toAccountId) || '',
            t.person || '',
            (t.type === 'expense' ? -t.amount : t.amount).toFixed(2).replace('.', ','),
            t.installment ? `${t.installment.index}/${t.installment.total}` : '',
            Number(t.workdayAmount) > 0 ? Number(t.workdayAmount).toFixed(2).replace('.', ',') : '',
        ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n');
    download(`caderneta_movimentacoes_${stamp()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}

/** Restaura um backup da v2 (mesclando) ou converte um backup da v1. */
export async function importBackupFile(file) {
    const text = await file.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('O arquivo não é um JSON válido.');
    }

    if (data?.version === BACKUP_VERSION && data.data) {
        let count = 0;
        for (const collection of COLLECTIONS) {
            const rows = Array.isArray(data.data[collection]) ? data.data[collection].filter((r) => r && r.id) : [];
            await saveMany(collection, rows);
            count += rows.length;
        }
        return { kind: 'v2', count };
    }
    if (isLegacyBackup(data)) {
        const converted = await importLegacyData(data);
        return { kind: 'v1', count: converted.transactions.length };
    }
    throw new Error('Formato de backup não reconhecido.');
}
