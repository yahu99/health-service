ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders DROP CONSTRAINT orders_check;
ALTER TABLE orders ADD COLUMN delivery_slot_id BIGINT;
ALTER TABLE orders ADD COLUMN idempotency_key VARCHAR(128);
ALTER TABLE orders ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (
    status IN ('PENDING', 'PAID', 'REJECTED', 'PROCESSING', 'COMPENSATING', 'CONFIRMED', 'CANCELLED')
);
ALTER TABLE orders ADD CONSTRAINT orders_reason_check CHECK (
    (status IN ('PENDING', 'PAID', 'PROCESSING', 'CONFIRMED') AND reason IS NULL)
    OR (status IN ('REJECTED', 'COMPENSATING', 'CANCELLED') AND reason IS NOT NULL)
);
ALTER TABLE orders ADD CONSTRAINT orders_saga_input_check CHECK (
    (status IN ('PENDING', 'PAID', 'REJECTED') AND idempotency_key IS NULL AND delivery_slot_id IS NULL)
    OR (status IN ('PROCESSING', 'COMPENSATING', 'CONFIRMED', 'CANCELLED')
        AND idempotency_key IS NOT NULL AND length(idempotency_key) > 0
        AND delivery_slot_id IS NOT NULL AND delivery_slot_id BETWEEN 1 AND 9007199254740991
        AND product_id IS NOT NULL)
);
ALTER TABLE orders ADD CONSTRAINT orders_idempotency_key UNIQUE(user_id, idempotency_key);
CREATE INDEX orders_pending_saga_idx ON orders(next_attempt_at, id)
    WHERE status IN ('PROCESSING', 'COMPENSATING');

CREATE TABLE order_saga_steps (
    order_id BIGINT NOT NULL REFERENCES orders(id),
    step TEXT NOT NULL CHECK (step IN ('BILLING', 'WAREHOUSE', 'DELIVERY')),
    status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN (
        'NOT_STARTED', 'IN_PROGRESS', 'SUCCEEDED', 'REJECTED', 'COMPENSATING', 'COMPENSATED'
    )),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(order_id, step)
);
