import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, withTransaction } from './db.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name       text PRIMARY KEY,
            applied_at timestamptz NOT NULL DEFAULT now()
        )
    `);

    const { rows } = await pool.query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    const ran = [];
    for (const file of files) {
        if (applied.has(file)) continue;
        const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
        await withTransaction(pool, async (client) => {
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        });
        ran.push(file);
    }
    return ran;
}

// Execução direta: `npm run migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const pool = createPool();
    migrate(pool)
        .then((ran) => console.log(ran.length ? `Migrações aplicadas: ${ran.join(', ')}` : 'Banco já está atualizado.'))
        .catch((error) => {
            console.error(error);
            process.exitCode = 1;
        })
        .finally(() => pool.end());
}
