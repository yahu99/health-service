CREATE TABLE products (
    id BIGINT PRIMARY KEY CHECK (id > 0 AND id <= 9007199254740991),
    name TEXT NOT NULL CHECK (length(name) > 0),
    unit_price BIGINT NOT NULL CHECK (unit_price > 0 AND unit_price <= 9007199254740991)
);

INSERT INTO products(id, name, unit_price) VALUES
    (1, 'Книга', 1000),
    (2, 'Кружка', 500),
    (3, 'Рюкзак', 2500);

-- Historical orders retain their original total; their product is unknown.
ALTER TABLE orders
    ADD COLUMN product_id BIGINT REFERENCES products(id),
    ADD COLUMN quantity BIGINT,
    ADD COLUMN unit_price BIGINT;

ALTER TABLE orders ADD CONSTRAINT orders_product_snapshot_check CHECK (
    (product_id IS NULL AND quantity IS NULL AND unit_price IS NULL)
    OR (
        product_id IS NOT NULL AND quantity IS NOT NULL AND unit_price IS NOT NULL
        AND quantity BETWEEN 1 AND 9007199254740991
        AND unit_price BETWEEN 1 AND 9007199254740991
        AND price::NUMERIC = quantity::NUMERIC * unit_price::NUMERIC
    )
);
