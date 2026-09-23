import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';

const SESSION_DAYS = 90;
// Evita um UPDATE a cada requisição: só renova a sessão se o último uso foi há mais de 1h.
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

const registerSchema = z.object({
    name: z.string().trim().min(1, 'Informe seu nome.').max(80),
    email: z.email('E-mail inválido.').max(200).transform((e) => e.toLowerCase()),
    password: z.string().min(8, 'A senha precisa ter pelo menos 8 caracteres.').max(200),
});

const loginSchema = z.object({
    email: z.string().trim().max(200).transform((e) => e.toLowerCase()),
    password: z.string().max(200),
});

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const publicUser = (row) => ({ id: row.id, name: row.name, email: row.email, createdAt: row.created_at });

async function createSession(pool, userId, userAgent) {
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query(
        `INSERT INTO sessions (token_hash, user_id, user_agent, expires_at)
         VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
        [hashToken(token), userId, userAgent?.slice(0, 300) ?? null, SESSION_DAYS],
    );
    return token;
}

function readToken(req) {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    return scheme === 'Bearer' && token ? token : null;
}

export function requireAuth(pool) {
    return async (req, res, next) => {
        try {
            const token = readToken(req);
            if (!token) return res.status(401).json({ error: 'Sessão ausente.' });

            const tokenHash = hashToken(token);
            const { rows } = await pool.query(
                `SELECT s.last_seen_at, u.id, u.name, u.email, u.created_at
                   FROM sessions s JOIN users u ON u.id = s.user_id
                  WHERE s.token_hash = $1 AND s.expires_at > now()`,
                [tokenHash],
            );
            if (!rows.length) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });

            const session = rows[0];
            if (Date.now() - new Date(session.last_seen_at).getTime() > TOUCH_INTERVAL_MS) {
                await pool.query(
                    `UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2)
                      WHERE token_hash = $1`,
                    [tokenHash, SESSION_DAYS],
                );
            }

            req.user = publicUser(session);
            req.tokenHash = tokenHash;
            next();
        } catch (error) {
            next(error);
        }
    };
}

export function authRouter(pool, { rateLimitMax = 20 } = {}) {
    const router = Router();
    const limiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: rateLimitMax,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: 'Muitas tentativas. Aguarde alguns minutos.' },
    });

    router.post('/register', limiter, async (req, res, next) => {
        try {
            const parsed = registerSchema.safeParse(req.body);
            if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
            const { name, email, password } = parsed.data;

            const passwordHash = await bcrypt.hash(password, 11);
            const { rows } = await pool.query(
                `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
                 ON CONFLICT (email) DO NOTHING
                 RETURNING id, name, email, created_at`,
                [name, email, passwordHash],
            );
            if (!rows.length) return res.status(409).json({ error: 'Já existe uma conta com esse e-mail.' });

            const token = await createSession(pool, rows[0].id, req.get('user-agent'));
            res.status(201).json({ token, user: publicUser(rows[0]) });
        } catch (error) {
            next(error);
        }
    });

    router.post('/login', limiter, async (req, res, next) => {
        try {
            const parsed = loginSchema.safeParse(req.body);
            if (!parsed.success) return res.status(400).json({ error: 'Informe e-mail e senha.' });
            const { email, password } = parsed.data;

            const { rows } = await pool.query(
                'SELECT id, name, email, created_at, password_hash FROM users WHERE email = $1',
                [email],
            );
            const valid = rows.length && (await bcrypt.compare(password, rows[0].password_hash));
            if (!valid) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });

            const token = await createSession(pool, rows[0].id, req.get('user-agent'));
            res.json({ token, user: publicUser(rows[0]) });
        } catch (error) {
            next(error);
        }
    });

    router.get('/me', requireAuth(pool), (req, res) => {
        res.json({ user: req.user });
    });

    router.post('/logout', requireAuth(pool), async (req, res, next) => {
        try {
            await pool.query('DELETE FROM sessions WHERE token_hash = $1', [req.tokenHash]);
            res.status(204).end();
        } catch (error) {
            next(error);
        }
    });

    // Exclusão definitiva da conta e de todos os dados na nuvem (os dados locais do aparelho continuam).
    router.delete('/account', limiter, requireAuth(pool), async (req, res, next) => {
        try {
            const password = String(req.body?.password ?? '');
            const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
            if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
                return res.status(401).json({ error: 'Senha incorreta.' });
            }
            await pool.query('DELETE FROM users WHERE id = $1', [req.user.id]);
            res.status(204).end();
        } catch (error) {
            next(error);
        }
    });

    return router;
}
