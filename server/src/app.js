import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { authRouter } from './auth.js';
import { syncRouter } from './sync.js';

export function createApp(pool, { staticDir, rateLimitMax } = {}) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 1);

    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                'default-src': ["'self'"],
                'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
                'font-src': ["'self'", 'https://fonts.gstatic.com'],
                'img-src': ["'self'", 'data:'],
            },
        },
    }));
    app.use(express.json({ limit: '5mb' }));

    app.get('/api/health', async (req, res) => {
        try {
            await pool.query('SELECT 1');
            res.json({ ok: true });
        } catch {
            res.status(503).json({ ok: false });
        }
    });

    app.use('/api/auth', authRouter(pool, { rateLimitMax }));
    app.use('/api/sync', syncRouter(pool));
    app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

    // Em produção o próprio servidor entrega o PWA compilado (client/dist).
    if (staticDir && existsSync(staticDir)) {
        app.use(express.static(staticDir, {
            setHeaders(res, filePath) {
                if (filePath.endsWith('sw.js') || filePath.endsWith('index.html')) {
                    res.setHeader('Cache-Control', 'no-cache');
                }
            },
        }));
        app.get('/{*splat}', (req, res) => res.sendFile(path.join(staticDir, 'index.html')));
    }

    // eslint-disable-next-line no-unused-vars
    app.use((error, req, res, next) => {
        if (error.type === 'entity.too.large') {
            return res.status(413).json({ error: 'Envio grande demais.' });
        }
        if (error.type === 'entity.parse.failed') {
            return res.status(400).json({ error: 'JSON inválido.' });
        }
        console.error(error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    });

    return app;
}
