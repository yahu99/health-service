const Router = require("@koa/router");
const { query } = require("./db");
const config = require("./config");
const { post } = require("./http-client");
const { fail, objectBody, positiveInteger, pathInteger, email, safeNumber } = require("./validation");
const router = new Router({ prefix: "/internal" });

router.post("/orders", async (ctx) => {
    const body = objectBody(ctx);
    const userId = positiveInteger(body.userId);
    const price = positiveInteger(body.price);
    const address = email(body.email);
    const created = await query("INSERT INTO orders(user_id, email, price) VALUES ($1, $2, $3) RETURNING id", [userId, address, price]);
    const orderId = safeNumber(created.rows[0].id);
    let status = "PAID";
    let reason = null;
    try {
        await post(config.billingServiceUrl, "/internal/withdrawals", { userId, orderId, amount: price });
    } catch (error) {
        if (error.status !== 409 || error.apiCode !== "INSUFFICIENT_FUNDS") throw error;
        status = "REJECTED";
        reason = "INSUFFICIENT_FUNDS";
    }
    await query("UPDATE orders SET status = $2, reason = $3 WHERE id = $1", [orderId, status, reason]);
    // The create response is returned only after the message is saved.
    await post(config.notificationServiceUrl, "/internal/notifications", {
        userId, orderId, email: address, amount: price, result: status, reason,
    });
    ctx.status = 201;
    ctx.body = { orderId, status, reason };
});

router.get("/orders/:orderId", async (ctx) => {
    const orderId = pathInteger(ctx.params.orderId);
    const userId = pathInteger(ctx.query.userId);
    const result = await query("SELECT user_id, price, status, reason FROM orders WHERE id = $1", [orderId]);
    if (!result.rowCount) fail(404, "ORDER_NOT_FOUND");
    const order = result.rows[0];
    if (safeNumber(order.user_id) !== userId) fail(403, "FORBIDDEN");
    ctx.body = { orderId, price: safeNumber(order.price), status: order.status, reason: order.reason };
});

module.exports = router;
