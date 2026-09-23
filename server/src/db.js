import pg from 'pg';

export function createPool(connectionString = process.env.DATABASE_URL) {
    if (!connectionString) {
        throw new Error('DATABASE_URL não definida. Veja server/.env.example.');
    }
    return new pg.Pool({ connectionString, max: 10 });
}

export async function withTransaction(pool, fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
