CREATE TABLE delivery_couriers (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL
);
INSERT INTO delivery_couriers(id, name) VALUES (1, 'Курьер 1');

CREATE TABLE delivery_slots (
    id BIGINT PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
    starts_at TIMESTAMPTZ NOT NULL UNIQUE,
    ends_at TIMESTAMPTZ NOT NULL,
    CHECK (ends_at = starts_at + INTERVAL '1 hour'),
    CHECK (EXTRACT(EPOCH FROM starts_at) = id::NUMERIC * 3600)
);

CREATE TABLE delivery_bookings (
    order_id BIGINT PRIMARY KEY CHECK (order_id BETWEEN 1 AND 9007199254740991),
    slot_id BIGINT NOT NULL CHECK (slot_id BETWEEN 1 AND 9007199254740991),
    courier_id BIGINT REFERENCES delivery_couriers(id),
    status TEXT NOT NULL CHECK (status IN ('SUCCEEDED', 'REJECTED', 'COMPENSATED')),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (status = 'REJECTED' AND courier_id IS NULL AND reason IS NOT NULL
            AND reason IN ('SLOT_NOT_FOUND', 'SLOT_EXPIRED', 'NO_COURIER_AVAILABLE'))
        OR (status IN ('SUCCEEDED', 'COMPENSATED') AND courier_id IS NOT NULL AND reason IS NULL)
    )
);
CREATE UNIQUE INDEX delivery_active_booking_idx ON delivery_bookings(courier_id, slot_id)
    WHERE status = 'SUCCEEDED';

-- UTC epoch hours identify non-overlapping slots independently of the DB timezone.
INSERT INTO delivery_slots(id, starts_at, ends_at)
SELECT hour, to_timestamp(hour * 3600), to_timestamp((hour + 1) * 3600)
FROM generate_series(
    floor(EXTRACT(EPOCH FROM NOW()) / 3600)::BIGINT + 1,
    floor(EXTRACT(EPOCH FROM NOW()) / 3600)::BIGINT + 168
) AS hour;
