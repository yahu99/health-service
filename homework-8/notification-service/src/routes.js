const Router = require("@koa/router");
const { query } = require("./db");
const { fail, objectBody, positiveInteger, pathInteger, email, safeNumber } = require("./validation");
const router = new Router({ prefix: "/internal" });

router.post("/notifications", async (ctx) => {
    const body = objectBody(ctx);
    const userId = positiveInteger(body.userId);
    const orderId = positiveInteger(body.orderId);
    const amount = positiveInteger(body.amount);
    const address = email(body.email);
    const { result } = body;
    const reason = body.reason ?? null;
    if (!['PAID', 'REJECTED'].includes(result) || (result === 'PAID' && reason !== null) || (result === 'REJECTED' && reason !== 'INSUFFICIENT_FUNDS')) fail(400, "INVALID_REQUEST");
    const message = result === "PAID"
        ? `Заказ №${orderId} оформлен. Оплата ${amount} прошла успешно.`
        : `Заказ №${orderId} не оформлен: недостаточно средств для оплаты ${amount}.`;
    const created = await query(`
        INSERT INTO notifications(user_id, order_id, email, amount, result, reason, body)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (order_id) DO NOTHING RETURNING id
    `, [userId, orderId, address, amount, result, reason, message]);
    if (created.rowCount) {
        ctx.status = 201;
        ctx.body = { notificationId: safeNumber(created.rows[0].id) };
        return;
    }
    const previous = (await query("SELECT * FROM notifications WHERE order_id = $1", [orderId])).rows[0];
    if (safeNumber(previous.user_id) !== userId || previous.email !== address || safeNumber(previous.amount) !== amount || previous.result !== result || previous.reason !== reason) fail(409, "CONFLICT");
    ctx.body = { notificationId: safeNumber(previous.id) };
});

router.get("/notifications", async (ctx) => {
    const userId = pathInteger(ctx.query.userId);
    const orderId = ctx.query.orderId === undefined ? null : pathInteger(ctx.query.orderId);
    const result = await query(`
        SELECT order_id AS "orderId", email, result, body
        FROM notifications WHERE user_id = $1 AND ($2::bigint IS NULL OR order_id = $2)
        ORDER BY id
    `, [userId, orderId]);
    ctx.body = { items: result.rows.map((row) => ({ ...row, orderId: safeNumber(row.orderId) })) };
});

module.exports = router;
