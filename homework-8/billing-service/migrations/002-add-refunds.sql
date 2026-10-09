ALTER TABLE balance_history ADD COLUMN kind TEXT;
UPDATE balance_history
SET kind = CASE WHEN order_id IS NULL THEN 'DEPOSIT' ELSE 'WITHDRAWAL' END;
ALTER TABLE balance_history ALTER COLUMN kind SET NOT NULL;
ALTER TABLE balance_history ALTER COLUMN kind SET DEFAULT 'DEPOSIT';

ALTER TABLE balance_history DROP CONSTRAINT balance_history_order_id_key;
ALTER TABLE balance_history DROP CONSTRAINT balance_history_check;
ALTER TABLE balance_history ADD CONSTRAINT balance_history_kind_check CHECK (
    (kind = 'DEPOSIT' AND amount > 0 AND order_id IS NULL)
    OR (kind = 'WITHDRAWAL' AND amount < 0 AND order_id IS NOT NULL)
    OR (kind = 'REFUND' AND amount > 0 AND order_id IS NOT NULL)
);
ALTER TABLE balance_history ADD CONSTRAINT balance_history_order_kind_key
    UNIQUE (order_id, kind);
