CREATE TABLE billing_operations (
    order_id BIGINT PRIMARY KEY CHECK (order_id BETWEEN 1 AND 9007199254740991),
    user_id BIGINT NOT NULL CHECK (user_id BETWEEN 1 AND 9007199254740991),
    amount BIGINT NOT NULL CHECK (amount BETWEEN 1 AND 9007199254740991),
    status TEXT NOT NULL CHECK (status IN ('SUCCEEDED', 'REJECTED', 'COMPENSATED')),
    reason TEXT,
    withdrawal_id BIGINT REFERENCES balance_history(id),
    refund_id BIGINT REFERENCES balance_history(id),
    CHECK (
        (status = 'REJECTED' AND reason IS NOT NULL AND withdrawal_id IS NULL AND refund_id IS NULL)
        OR (status = 'SUCCEEDED' AND reason IS NULL AND withdrawal_id IS NOT NULL AND refund_id IS NULL)
        OR (status = 'COMPENSATED' AND reason IS NULL AND withdrawal_id IS NOT NULL AND refund_id IS NOT NULL)
    )
);

INSERT INTO billing_operations(order_id, user_id, amount, status, withdrawal_id, refund_id)
SELECT w.order_id, a.user_id, -w.amount,
    CASE WHEN r.id IS NULL THEN 'SUCCEEDED' ELSE 'COMPENSATED' END, w.id, r.id
FROM balance_history w
JOIN billing_accounts a ON a.id = w.account_id
LEFT JOIN balance_history r ON r.order_id = w.order_id AND r.kind = 'REFUND'
WHERE w.kind = 'WITHDRAWAL';
