// Sobe um PostgreSQL local sem precisar de Docker nem instalação (usa o pacote embedded-postgres).
// Os dados ficam em server/.pgdata. Ctrl+C encerra o banco.
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseDir = path.join(root, '.pgdata');
const port = Number(process.env.PGPORT) || 5433;

const pg = new EmbeddedPostgres({
    databaseDir,
    user: 'caderneta',
    password: 'caderneta',
    port,
    persistent: true,
});

if (!existsSync(databaseDir)) {
    await pg.initialise();
}
await pg.start();
try {
    await pg.createDatabase('caderneta');
} catch {
    // já existe
}

console.log(`PostgreSQL pronto: postgres://caderneta:caderneta@localhost:${port}/caderneta`);

const stop = async () => {
    await pg.stop();
    process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
