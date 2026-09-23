export class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

export async function apiFetch(path, { method = 'GET', body, token, timeout = 20000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let res;
    try {
        res = await fetch(`/api${path}`, {
            method,
            headers: {
                ...(body ? { 'content-type': 'application/json' } : {}),
                ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
    } catch {
        throw new ApiError('Sem conexão com o servidor.', 0);
    } finally {
        clearTimeout(timer);
    }

    const text = await res.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        // resposta não-JSON (ex.: servidor fora do ar atrás de um proxy)
    }
    if (!res.ok) throw new ApiError(data?.error || 'Não foi possível falar com o servidor.', res.status);
    return data;
}
