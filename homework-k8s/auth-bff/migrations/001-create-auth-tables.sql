CREATE TABLE auth_credentials (
    user_id BIGINT PRIMARY KEY,
    username VARCHAR(256) NOT NULL UNIQUE,
    password_salt BYTEA NOT NULL,
    password_hash BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE auth_sessions (
    token_hash BYTEA PRIMARY KEY,
    user_id BIGINT NOT NULL
        REFERENCES auth_credentials(user_id)
        ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX auth_sessions_user_id_idx ON auth_sessions (user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions (expires_at);
