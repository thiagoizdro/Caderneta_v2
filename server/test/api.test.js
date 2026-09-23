import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import EmbeddedPostgres from 'embedded-postgres';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';

let pg, pool, server, baseUrl, dataDir;

before(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'caderneta-test-'));
    const port = 20000 + Math.floor(Math.random() * 20000);
    pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'test', password: 'test', port, persistent: false });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('caderneta_test');

    pool = createPool(`postgres://test:test@localhost:${port}/caderneta_test`);
    await migrate(pool);

    server = createApp(pool, { rateLimitMax: 1000 }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
    server?.close();
    await pool?.end();
    await pg?.stop();
    await rm(dataDir, { recursive: true, force: true });
});

async function api(method, url, { body, token } = {}) {
    const res = await fetch(baseUrl + url, {
        method,
        headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function register(email) {
    const res = await api('POST', '/api/auth/register', { body: { name: 'Teste', email, password: 'senha-segura-123' } });
    assert.equal(res.status, 201);
    return res.body.token;
}

describe('migrações', () => {
    test('são idempotentes', async () => {
        assert.deepEqual(await migrate(pool), []);
    });
});

describe('autenticação', () => {
    test('cadastro, login, me e logout', async () => {
        const reg = await api('POST', '/api/auth/register', {
            body: { name: 'Ana', email: 'Ana@Exemplo.com', password: 'senha-segura-123' },
        });
        assert.equal(reg.status, 201);
        assert.equal(reg.body.user.email, 'ana@exemplo.com');
        assert.ok(reg.body.token);

        const dup = await api('POST', '/api/auth/register', {
            body: { name: 'Ana', email: 'ana@exemplo.com', password: 'outra-senha-123' },
        });
        assert.equal(dup.status, 409);

        const bad = await api('POST', '/api/auth/login', { body: { email: 'ana@exemplo.com', password: 'errada' } });
        assert.equal(bad.status, 401);

        const login = await api('POST', '/api/auth/login', { body: { email: 'ANA@exemplo.com', password: 'senha-segura-123' } });
        assert.equal(login.status, 200);

        const me = await api('GET', '/api/auth/me', { token: login.body.token });
        assert.equal(me.status, 200);
        assert.equal(me.body.user.name, 'Ana');

        assert.equal((await api('POST', '/api/auth/logout', { token: login.body.token })).status, 204);
        assert.equal((await api('GET', '/api/auth/me', { token: login.body.token })).status, 401);
        // A outra sessão (do cadastro) continua válida.
        assert.equal((await api('GET', '/api/auth/me', { token: reg.body.token })).status, 200);
    });

    test('valida senha curta', async () => {
        const res = await api('POST', '/api/auth/register', { body: { name: 'X', email: 'x@x.com', password: '123' } });
        assert.equal(res.status, 400);
    });

    test('sync exige sessão', async () => {
        assert.equal((await api('POST', '/api/sync', { body: {} })).status, 401);
    });
});

describe('sincronização', () => {
    test('envia de um aparelho e recebe no outro', async () => {
        const token = await register('sync1@exemplo.com');

        const push = await api('POST', '/api/sync', {
            token,
            body: {
                cursor: 0,
                changes: [
                    { collection: 'transactions', id: 't1', updatedAt: 1000, data: { amount: 50, description: 'Mercado' } },
                    { collection: 'accounts', id: 'a1', updatedAt: 1000, data: { name: 'Carteira' } },
                ],
            },
        });
        assert.equal(push.status, 200);
        assert.equal(push.body.accepted, 2);

        const other = await api('POST', '/api/sync', { token, body: { cursor: 0 } });
        assert.equal(other.body.changes.length, 2);
        assert.equal(other.body.hasMore, false);

        const again = await api('POST', '/api/sync', { token, body: { cursor: other.body.cursor } });
        assert.equal(again.body.changes.length, 0);
        assert.equal(again.body.cursor, other.body.cursor);
    });

    test('última escrita vence', async () => {
        const token = await register('sync2@exemplo.com');
        const send = (updatedAt, amount, deleted = false) => api('POST', '/api/sync', {
            token,
            body: { cursor: 0, changes: [{ collection: 'transactions', id: 'x', updatedAt, deleted, data: { amount } }] },
        });

        await send(2000, 10);
        const stale = await send(1500, 99);
        assert.equal(stale.body.accepted, 0);
        assert.equal(stale.body.changes[0].data.amount, 10);

        const newer = await send(2500, 20, true);
        assert.equal(newer.body.accepted, 1);
        assert.equal(newer.body.changes[0].deleted, true);
        assert.equal(newer.body.changes[0].updatedAt, 2500);
    });

    test('dados de um usuário não vazam para outro', async () => {
        const a = await register('isolado-a@exemplo.com');
        const b = await register('isolado-b@exemplo.com');
        await api('POST', '/api/sync', {
            token: a,
            body: { changes: [{ collection: 'goals', id: 'g', updatedAt: 1, data: { name: 'PC novo' } }] },
        });
        const res = await api('POST', '/api/sync', { token: b, body: { cursor: 0 } });
        assert.equal(res.body.changes.length, 0);
    });

    test('pagina resultados grandes', async () => {
        const token = await register('paginas@exemplo.com');
        const changes = Array.from({ length: 1000 }, (_, i) => ({
            collection: 'transactions', id: `p${i}`, updatedAt: 1, data: { i },
        }));
        await api('POST', '/api/sync', { token, body: { changes } });
        await api('POST', '/api/sync', { token, body: { changes: [{ collection: 'accounts', id: 'extra', updatedAt: 1, data: {} }] } });

        const first = await api('POST', '/api/sync', { token, body: { cursor: 0 } });
        assert.equal(first.body.changes.length, 1000);
        assert.equal(first.body.hasMore, true);

        const second = await api('POST', '/api/sync', { token, body: { cursor: first.body.cursor } });
        assert.equal(second.body.changes.length, 1);
        assert.equal(second.body.hasMore, false);
    });

    test('rejeita coleção desconhecida', async () => {
        const token = await register('invalido@exemplo.com');
        const res = await api('POST', '/api/sync', {
            token,
            body: { changes: [{ collection: 'users', id: '1', updatedAt: 1, data: {} }] },
        });
        assert.equal(res.status, 400);
    });

    test('excluir conta apaga os dados da nuvem', async () => {
        const token = await register('apagar@exemplo.com');
        await api('POST', '/api/sync', { token, body: { changes: [{ collection: 'goals', id: 'g', updatedAt: 1, data: {} }] } });

        assert.equal((await api('DELETE', '/api/auth/account', { token, body: { password: 'errada' } })).status, 401);
        assert.equal((await api('DELETE', '/api/auth/account', { token, body: { password: 'senha-segura-123' } })).status, 204);
        assert.equal((await api('GET', '/api/auth/me', { token })).status, 401);
        const { rows } = await pool.query("SELECT count(*)::int AS n FROM users WHERE email = 'apagar@exemplo.com'");
        assert.equal(rows[0].n, 0);
    });
});
