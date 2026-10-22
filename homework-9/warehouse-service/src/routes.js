const Router = require("@koa/router");
const { pool, query } = require("./db");
const { fail, objectBody, positiveInteger, pathInteger, safeNumber } = require("./validation");
const router = new Router({ prefix: "/internal" });

function operation(row) {
    return {
        orderId: safeNumber(row.order_id), productId: safeNumber(row.product_id),
        quantity: safeNumber(row.quantity), status: row.status, reason: row.reason,
    };
}

async function transaction(orderId, callback) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        // Also serialize requests before an operation row exists. Hash collisions only add waiting.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`warehouse:${orderId}`]);
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

router.get("/stock/:productId", async (ctx) => {
    const productId = pathInteger(ctx.params.productId);
    const result = await query("SELECT available FROM warehouse_stock WHERE product_id = $1", [productId]);
    if (!result.rowCount) fail(404, "PRODUCT_NOT_FOUND");
    ctx.body = { productId, available: safeNumber(result.rows[0].available) };
});

router.get("/operations/:orderId", async (ctx) => {
    const orderId = pathInteger(ctx.params.orderId);
    const result = await query("SELECT * FROM warehouse_reservations WHERE order_id = $1", [orderId]);
    if (!result.rowCount) fail(404, "OPERATION_NOT_FOUND");
    ctx.body = operation(result.rows[0]);
});

router.post("/reservations", async (ctx) => {
    const body = objectBody(ctx);
    if (Object.keys(body).some(key => !["orderId", "productId", "quantity"].includes(key))) fail(400, "INVALID_REQUEST");
    const orderId = positiveInteger(body.orderId);
    const productId = positiveInteger(body.productId);
    const quantity = positiveInteger(body.quantity);
    const result = await transaction(orderId, async (client) => {
        const previous = await client.query("SELECT * FROM warehouse_reservations WHERE order_id = $1", [orderId]);
        if (previous.rowCount) {
            const row = previous.rows[0];
            if (safeNumber(row.product_id) !== productId || safeNumber(row.quantity) !== quantity) fail(409, "IDEMPOTENCY_CONFLICT");
            return operation(row);
        }
        const stock = await client.query("SELECT available FROM warehouse_stock WHERE product_id = $1 FOR UPDATE", [productId]);
        const reason = !stock.rowCount ? "PRODUCT_NOT_FOUND"
            : BigInt(stock.rows[0].available) < BigInt(quantity) ? "OUT_OF_STOCK" : null;
        if (!reason) {
            await client.query("UPDATE warehouse_stock SET available = available - $2 WHERE product_id = $1", [productId, quantity]);
        }
        const saved = await client.query(`INSERT INTO warehouse_reservations(order_id, product_id, quantity, status, reason)
            VALUES ($1, $2, $3, $4, $5) RETURNING *`, [orderId, productId, quantity, reason ? "REJECTED" : "SUCCEEDED", reason]);
        return operation(saved.rows[0]);
    });
    // Return a business rejection only after committing its durable result.
    ctx.status = result.status === "REJECTED" ? 409 : 200;
    ctx.body = result.status === "REJECTED" ? { ...result, code: result.reason } : result;
});

router.post("/reservations/:orderId/cancel", async (ctx) => {
    const orderId = pathInteger(ctx.params.orderId);
    ctx.body = await transaction(orderId, async (client) => {
        const previous = await client.query("SELECT * FROM warehouse_reservations WHERE order_id = $1", [orderId]);
        if (!previous.rowCount) fail(404, "OPERATION_NOT_FOUND");
        const row = previous.rows[0];
        if (row.status !== "SUCCEEDED") return operation(row);
        await client.query("UPDATE warehouse_stock SET available = available + $2 WHERE product_id = $1", [row.product_id, row.quantity]);
        const saved = await client.query("UPDATE warehouse_reservations SET status = 'COMPENSATED' WHERE order_id = $1 RETURNING *", [orderId]);
        return operation(saved.rows[0]);
    });
});

module.exports = router;
