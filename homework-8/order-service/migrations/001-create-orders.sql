CREATE TABLE orders (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL CHECK (user_id > 0),
    email VARCHAR(320) NOT NULL,
    price BIGINT NOT NULL CHECK (price > 0 AND price <= 9007199254740991),
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'REJECTED')),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((status IN ('PENDING', 'PAID') AND reason IS NULL) OR (status = 'REJECTED' AND reason = 'INSUFFICIENT_FUNDS'))
);

CREATE INDEX orders_user_id_idx ON orders(user_id);
