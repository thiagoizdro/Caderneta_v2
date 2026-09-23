-- Caderneta 2.0 — esquema inicial
--
-- Os dados financeiros ficam em `records`: um documento JSON por registro,
-- separado por coleção (transactions, accounts, categories...). Esse formato
-- é o que permite a sincronização offline-first: cada dispositivo envia e
-- recebe documentos inteiros, com resolução de conflito "última escrita vence"
-- (updated_at) e um cursor global (seq) para buscar apenas o que mudou.

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    token_hash   text PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent   text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL
);

CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE SEQUENCE sync_seq;

CREATE TABLE records (
    user_id    uuid    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    collection text    NOT NULL,
    id         text    NOT NULL,
    data       jsonb   NOT NULL,
    deleted    boolean NOT NULL DEFAULT false,
    updated_at bigint  NOT NULL,             -- relógio do cliente (ms), usado no "última escrita vence"
    seq        bigint  NOT NULL DEFAULT nextval('sync_seq'),
    PRIMARY KEY (user_id, collection, id)
);

CREATE INDEX records_user_seq_idx ON records (user_id, seq);
