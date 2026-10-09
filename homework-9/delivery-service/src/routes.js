const Router = require("@koa/router");
const { pool, query } = require("./db");
const { fail, objectBody, positiveInteger, pathInteger, safeNumber } = require("./validation");
const router = new Router({ prefix: "/internal" });

function operation(row) {
    return {
        orderId: safeNumber(row.order_id), deliverySlotId: safeNumber(row.slot_id),
        courierId: row.courier_id === null ? null : safeNumber(row.courier_id),
        status: row.status, reason: row.reason,
    };
}

async function transaction(orderId, callback) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`delivery:${orderId}`]);
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

router.get("/slots", async (ctx) => {
    // Extend the persisted catalog so the application does not run out of slots after a week.
    await query(`INSERT INTO delivery_slots(id, starts_at, ends_at)
        SELECT hour, to_timestamp(hour * 3600), to_timestamp((hour + 1) * 3600)
        FROM generate_series(floor(EXTRACT(EPOCH FROM NOW()) / 3600)::BIGINT + 1,
            floor(EXTRACT(EPOCH FROM NOW()) / 3600)::BIGINT + 168) AS hour
        ON CONFLICT (id) DO NOTHING`);
    const result = await query(`SELECT s.id, s.starts_at, s.ends_at,
        (SELECT COUNT(*) FROM delivery_couriers c WHERE NOT EXISTS (
            SELECT 1 FROM delivery_bookings b WHERE b.courier_id = c.id
            AND b.slot_id = s.id AND b.status = 'SUCCEEDED')) AS available_couriers
        FROM delivery_slots s WHERE s.starts_at > NOW()
        ORDER BY s.starts_at LIMIT 168`);
    ctx.body = { items: result.rows.map(row => ({
        deliverySlotId: safeNumber(row.id), startsAt: row.starts_at, endsAt: row.ends_at,
        availableCouriers: safeNumber(row.available_couriers),
    })) };
});

router.get("/operations/:orderId", async (ctx) => {
    const orderId = pathInteger(ctx.params.orderId);
    const result = await query("SELECT * FROM delivery_bookings WHERE order_id = $1", [orderId]);
    if (!result.rowCount) fail(404, "OPERATION_NOT_FOUND");
    ctx.body = operation(result.rows[0]);
});

router.post("/bookings", async (ctx) => {
    const body = objectBody(ctx);
    if (Object.keys(body).some(key => !["orderId", "deliverySlotId"].includes(key))) fail(400, "INVALID_REQUEST");
    const orderId = positiveInteger(body.orderId);
    const slotId = positiveInteger(body.deliverySlotId);
    const result = await transaction(orderId, async client => {
        const previous = await client.query("SELECT * FROM delivery_bookings WHERE order_id = $1", [orderId]);
        if (previous.rowCount) {
            if (safeNumber(previous.rows[0].slot_id) !== slotId) fail(409, "IDEMPOTENCY_CONFLICT");
            return operation(previous.rows[0]);
        }
        // All booking/cancellation operations take the same slot lock before changing occupancy.
        const slot = await client.query("SELECT id FROM delivery_slots WHERE id = $1 FOR UPDATE", [slotId]);
        let reason = slot.rowCount ? null : "SLOT_NOT_FOUND";
        let courierId = null;
        if (!reason) {
            const time = await client.query("SELECT starts_at > clock_timestamp() AS future FROM delivery_slots WHERE id = $1", [slotId]);
            if (!time.rows[0].future) reason = "SLOT_EXPIRED";
        }
        if (!reason) {
            const courier = await client.query(`SELECT c.id FROM delivery_couriers c WHERE NOT EXISTS (
                SELECT 1 FROM delivery_bookings b WHERE b.courier_id = c.id
                AND b.slot_id = $1 AND b.status = 'SUCCEEDED') ORDER BY c.id LIMIT 1`, [slotId]);
            if (!courier.rowCount) reason = "NO_COURIER_AVAILABLE";
            else courierId = courier.rows[0].id;
        }
        const saved = await client.query(`INSERT INTO delivery_bookings(order_id, slot_id, courier_id, status, reason)
            VALUES ($1, $2, $3, $4, $5) RETURNING *`, [orderId, slotId, courierId, reason ? "REJECTED" : "SUCCEEDED", reason]);
        return operation(saved.rows[0]);
    });
    ctx.status = result.status === "REJECTED" ? 409 : 200;
    ctx.body = result.status === "REJECTED" ? { ...result, code: result.reason } : result;
});

router.post("/bookings/:orderId/cancel", async ctx => {
    const orderId = pathInteger(ctx.params.orderId);
    ctx.body = await transaction(orderId, async client => {
        const previous = await client.query("SELECT * FROM delivery_bookings WHERE order_id = $1", [orderId]);
        if (!previous.rowCount) fail(404, "OPERATION_NOT_FOUND");
        const row = previous.rows[0];
        if (row.status !== "SUCCEEDED") return operation(row);
        await client.query("SELECT id FROM delivery_slots WHERE id = $1 FOR UPDATE", [row.slot_id]);
        const result = await client.query("UPDATE delivery_bookings SET status = 'COMPENSATED' WHERE order_id = $1 RETURNING *", [orderId]);
        return operation(result.rows[0]);
    });
});

module.exports = router;
