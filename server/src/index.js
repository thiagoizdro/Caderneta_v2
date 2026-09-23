import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';

const port = Number(process.env.PORT) || 3001;
const staticDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');

const pool = createPool();
const ran = await migrate(pool);
if (ran.length) console.log(`Migrações aplicadas: ${ran.join(', ')}`);

createApp(pool, { staticDir }).listen(port, () => {
    console.log(`Caderneta API ouvindo em http://localhost:${port}`);
});
