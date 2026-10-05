CREATE TABLE notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL CHECK (user_id > 0),
    order_id BIGINT NOT NULL UNIQUE CHECK (order_id > 0),
    email VARCHAR(320) NOT NULL,
    amount BIGINT NOT NULL CHECK (amount > 0 AND amount <= 9007199254740991),
    result VARCHAR(16) NOT NULL CHECK (result IN ('PAID', 'REJECTED')),
    reason TEXT,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((result = 'PAID' AND reason IS NULL) OR (result = 'REJECTED' AND reason = 'INSUFFICIENT_FUNDS'))
);

CREATE INDEX notifications_user_order_idx ON notifications(user_id, order_id);
