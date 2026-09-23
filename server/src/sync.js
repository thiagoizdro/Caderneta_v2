import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from './auth.js';
import { withTransaction } from './db.js';

export const COLLECTIONS = [
    'settings',
    'accounts',
    'categories',
    'transactions',
    'recurrences',
    'goals',
    'goalDeposits',
];

export const MAX_PUSH = 1000;
export const PAGE_SIZE = 1000;

const changeSchema = z.object({
    collection: z.enum(COLLECTIONS),
    id: z.string().min(1).max(200),
    updatedAt: z.number().int().nonnegative(),
    deleted: z.boolean().default(false),
    data: z.record(z.string(), z.unknown()),
});

const syncSchema = z.object({
    cursor: z.coerce.number().int().nonnegative().default(0),
    changes: z.array(changeSchema).max(MAX_PUSH).default([]),
});

/**
 * Protocolo de sincronização (um único endpoint, push + pull):
 *
 *   POST /api/sync { cursor, changes: [{ collection, id, updatedAt, deleted, data }] }
 *   → { cursor, hasMore, changes: [...] }
 *
 * 1. As alterações enviadas são gravadas se forem mais novas que as do servidor
 *    ("última escrita vence", pelo updatedAt do cliente).
 * 2. O servidor devolve tudo o que mudou depois de `cursor`, em ordem de `seq`.
 *
 * Um lock consultivo por usuário serializa as sincronizações da mesma conta.
 * Sem ele, uma leitura poderia ver seq=10 já confirmado enquanto seq=9 ainda
 * está em outra transação — e o cliente pularia o 9 para sempre.
 */
export function syncRouter(pool) {
    const router = Router();

    router.post('/', requireAuth(pool), async (req, res, next) => {
        try {
            const parsed = syncSchema.safeParse(req.body);
            if (!parsed.success) {
                return res.status(400).json({ error: 'Formato de sincronização inválido.', details: parsed.error.issues.slice(0, 5) });
            }
            const { cursor, changes } = parsed.data;
            const userId = req.user.id;

            const result = await withTransaction(pool, async (client) => {
                await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);

                let accepted = 0;
                for (const change of changes) {
                    const { rowCount } = await client.query(
                        `INSERT INTO records (user_id, collection, id, data, deleted, updated_at)
                         VALUES ($1, $2, $3, $4, $5, $6)
                         ON CONFLICT (user_id, collection, id) DO UPDATE
                            SET data = EXCLUDED.data,
                                deleted = EXCLUDED.deleted,
                                updated_at = EXCLUDED.updated_at,
                                seq = EXCLUDED.seq
                          WHERE records.updated_at <= EXCLUDED.updated_at`,
                        [userId, change.collection, change.id, change.data, change.deleted, change.updatedAt],
                    );
                    accepted += rowCount;
                }

                const { rows } = await client.query(
                    `SELECT collection, id, data, deleted, updated_at, seq
                       FROM records
                      WHERE user_id = $1 AND seq > $2
                      ORDER BY seq
                      LIMIT $3`,
                    [userId, cursor, PAGE_SIZE + 1],
                );

                const hasMore = rows.length > PAGE_SIZE;
                const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
                return {
                    accepted,
                    hasMore,
                    cursor: page.length ? Number(page[page.length - 1].seq) : cursor,
                    changes: page.map((r) => ({
                        collection: r.collection,
                        id: r.id,
                        data: r.data,
                        deleted: r.deleted,
                        updatedAt: Number(r.updated_at),
                    })),
                };
            });

            res.json(result);
        } catch (error) {
            next(error);
        }
    });

    return router;
}
