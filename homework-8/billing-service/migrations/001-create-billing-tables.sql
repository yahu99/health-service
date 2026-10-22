CREATE TABLE billing_accounts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE CHECK (user_id > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE balance_history (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES billing_accounts(id),
    amount BIGINT NOT NULL CHECK (amount <> 0 AND amount BETWEEN -9007199254740991 AND 9007199254740991),
    order_id BIGINT UNIQUE CHECK (order_id > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((amount > 0 AND order_id IS NULL) OR (amount < 0 AND order_id IS NOT NULL))
);

CREATE INDEX balance_history_account_id_idx ON balance_history(account_id);
