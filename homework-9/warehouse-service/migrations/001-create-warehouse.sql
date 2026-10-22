CREATE TABLE warehouse_stock (
    product_id BIGINT PRIMARY KEY CHECK (product_id BETWEEN 1 AND 9007199254740991),
    available BIGINT NOT NULL CHECK (available BETWEEN 0 AND 9007199254740991)
);

-- Product identifiers match Order's catalog; Warehouse owns only inventory.
INSERT INTO warehouse_stock(product_id, available) VALUES (1, 10), (2, 20), (3, 5);

CREATE TABLE warehouse_reservations (
    order_id BIGINT PRIMARY KEY CHECK (order_id BETWEEN 1 AND 9007199254740991),
    product_id BIGINT NOT NULL CHECK (product_id BETWEEN 1 AND 9007199254740991),
    quantity BIGINT NOT NULL CHECK (quantity BETWEEN 1 AND 9007199254740991),
    status TEXT NOT NULL CHECK (status IN ('SUCCEEDED', 'REJECTED', 'COMPENSATED')),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (status = 'REJECTED' AND reason IS NOT NULL AND reason IN ('OUT_OF_STOCK', 'PRODUCT_NOT_FOUND'))
        OR (status IN ('SUCCEEDED', 'COMPENSATED') AND reason IS NULL)
    )
);
