const Router = require("@koa/router");
const { pool, query } = require("./db");
const { fail, objectBody, positiveInteger, pathInteger, email, safeNumber } = require("./validation");
const { advanceSaga } = require("./saga");
const logger = require("./logger");
const router = new Router({ prefix: "/internal" });

router.get("/products", async (ctx) => {
    const result = await query("SELECT id, name, unit_price FROM products ORDER BY id");
    ctx.body = { items: result.rows.map((row) => ({
        productId: safeNumber(row.id), name: row.name, unitPrice: safeNumber(row.unit_price),
    })) };
});

function serialize(order) {
    return {
        orderId: safeNumber(order.id),
        productId: order.product_id === null ? null : safeNumber(order.product_id),
        quantity: order.quantity === null ? null : safeNumber(order.quantity),
        unitPrice: order.unit_price === null ? null : safeNumber(order.unit_price),
        deliverySlotId: order.delivery_slot_id === null ? null : safeNumber(order.delivery_slot_id),
        price: safeNumber(order.price), status: order.status, reason: order.reason,
    };
}

router.post("/orders", async ctx => {
    const body = objectBody(ctx);
    if (Object.keys(body).some(key => !["userId", "email", "productId", "quantity", "deliverySlotId"].includes(key))) fail(400, "INVALID_REQUEST");
    const userId = positiveInteger(body.userId);
    const productId = positiveInteger(body.productId);
    const quantity = positiveInteger(body.quantity === undefined ? 1 : body.quantity);
    const slotId = positiveInteger(body.deliverySlotId);
    const address = email(body.email);
    const key = ctx.get("Idempotency-Key");
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key)) fail(400, "INVALID_IDEMPOTENCY_KEY");
    const client = await pool.connect();
    let order;
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`order-create:${userId}:${key}`]);
        const previous = await client.query("SELECT * FROM orders WHERE user_id = $1 AND idempotency_key = $2", [userId, key]);
        if (previous.rowCount) {
            order = previous.rows[0];
            if (safeNumber(order.product_id) !== productId || safeNumber(order.quantity) !== quantity
                || safeNumber(order.delivery_slot_id) !== slotId) fail(409, "IDEMPOTENCY_CONFLICT");
        } else {
            const product = await client.query("SELECT unit_price FROM products WHERE id = $1", [productId]);
            if (!product.rowCount) fail(404, "PRODUCT_NOT_FOUND");
            const unitPrice = safeNumber(product.rows[0].unit_price);
            const price = safeNumber(BigInt(unitPrice) * BigInt(quantity));
            const created = await client.query(`INSERT INTO orders(user_id, email, price, product_id, quantity,
                unit_price, delivery_slot_id, idempotency_key, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PROCESSING') RETURNING *`,
            [userId, address, price, productId, quantity, unitPrice, slotId, key]);
            order = created.rows[0];
            await client.query(`INSERT INTO order_saga_steps(order_id, step)
                VALUES ($1, 'BILLING'), ($1, 'WAREHOUSE'), ($1, 'DELIVERY')`, [order.id]);
        }
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
    ctx.status = ["PROCESSING", "COMPENSATING"].includes(order.status) ? 202 : 200;
    ctx.body = serialize(order);
    if (ctx.status === 202) {
        const orderId = safeNumber(order.id);
        // Start immediately after the order and its steps are committed. The response
        // does not wait for downstream services; the worker recovers interrupted work.
        void advanceSaga(orderId).catch((error) => {
            logger.error({ orderId, error }, "Immediate saga processing failed; worker will retry");
        });
    }
});

router.get("/orders/:orderId", async (ctx) => {
    const orderId = pathInteger(ctx.params.orderId);
    const userId = pathInteger(ctx.query.userId);
    const result = await query("SELECT * FROM orders WHERE id = $1", [orderId]);
    if (!result.rowCount) fail(404, "ORDER_NOT_FOUND");
    const order = result.rows[0];
    if (safeNumber(order.user_id) !== userId) fail(403, "FORBIDDEN");
    const steps = await query("SELECT step, status, attempts, last_error FROM order_saga_steps WHERE order_id = $1 ORDER BY CASE step WHEN 'BILLING' THEN 1 WHEN 'WAREHOUSE' THEN 2 ELSE 3 END", [orderId]);
    ctx.body = { ...serialize(order), steps: steps.rows.map(row => ({ step: row.step, status: row.status, attempts: row.attempts, lastError: row.last_error })) };
});

module.exports = router;
