const Router = require("@koa/router");
const { pool, query } = require("./db");
const { fail, objectBody, positiveInteger, pathInteger, safeNumber } = require("./validation");
const router = new Router({ prefix: "/internal" });

async function balance(client, accountId) {
    const result = await client.query("SELECT COALESCE(SUM(amount), 0) AS balance FROM balance_history WHERE account_id = $1", [accountId]);
    return safeNumber(result.rows[0].balance);
}

async function transaction(callback) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
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

async function lockedAccount(client, userId) {
    // Every history writer takes this same lock before reading the balance.
    const result = await client.query("SELECT id FROM billing_accounts WHERE user_id = $1 FOR UPDATE", [userId]);
    if (!result.rowCount) fail(404, "ACCOUNT_NOT_FOUND");
    return result.rows[0].id;
}

router.post("/accounts", async (ctx) => {
    const userId = positiveInteger(objectBody(ctx).userId);
    const created = await query("INSERT INTO billing_accounts(user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING RETURNING id", [userId]);
    const account = await query(`
        SELECT a.id, COALESCE(SUM(h.amount), 0) AS balance
        FROM billing_accounts a LEFT JOIN balance_history h ON h.account_id = a.id
        WHERE a.user_id = $1 GROUP BY a.id
    `, [userId]);
    ctx.status = created.rowCount ? 201 : 200;
    ctx.body = { accountId: safeNumber(account.rows[0].id), userId, balance: safeNumber(account.rows[0].balance) };
});

router.get("/accounts/by-user/:userId", async (ctx) => {
    const userId = pathInteger(ctx.params.userId);
    const result = await query(`
        SELECT a.id, COALESCE(SUM(h.amount), 0) AS balance
        FROM billing_accounts a LEFT JOIN balance_history h ON h.account_id = a.id
        WHERE a.user_id = $1 GROUP BY a.id
    `, [userId]);
    if (!result.rowCount) fail(404, "ACCOUNT_NOT_FOUND");
    ctx.body = { accountId: safeNumber(result.rows[0].id), userId, balance: safeNumber(result.rows[0].balance) };
});

router.post("/deposits", async (ctx) => {
    const body = objectBody(ctx);
    const userId = positiveInteger(body.userId);
    const amount = positiveInteger(body.amount);
    ctx.body = await transaction(async (client) => {
        const accountId = await lockedAccount(client, userId);
        const currentBalance = await balance(client, accountId);
        const newBalance = safeNumber(BigInt(currentBalance) + BigInt(amount));
        const result = await client.query("INSERT INTO balance_history(account_id, amount) VALUES ($1, $2) RETURNING id", [accountId, amount]);
        return { operationId: safeNumber(result.rows[0].id), balance: newBalance };
    });
    ctx.status = 201;
});

function operation(row) {
    return {
        orderId: safeNumber(row.order_id), userId: safeNumber(row.user_id), amount: safeNumber(row.amount),
        status: row.status, reason: row.reason,
        withdrawalId: row.withdrawal_id === null ? null : safeNumber(row.withdrawal_id),
        refundId: row.refund_id === null ? null : safeNumber(row.refund_id),
    };
}

async function lockOperation(client, orderId) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`billing:${orderId}`]);
}

router.get("/operations/:orderId", async ctx => {
    const orderId = pathInteger(ctx.params.orderId);
    const result = await query("SELECT * FROM billing_operations WHERE order_id = $1", [orderId]);
    if (!result.rowCount) fail(404, "OPERATION_NOT_FOUND");
    ctx.body = operation(result.rows[0]);
});

router.post("/withdrawals", async (ctx) => {
    const body = objectBody(ctx);
    const userId = positiveInteger(body.userId);
    const orderId = positiveInteger(body.orderId);
    const amount = positiveInteger(body.amount);
    const result = await transaction(async client => {
        await lockOperation(client, orderId);
        const previous = await client.query("SELECT * FROM billing_operations WHERE order_id = $1", [orderId]);
        if (previous.rowCount) {
            const row = previous.rows[0];
            if (safeNumber(row.user_id) !== userId || safeNumber(row.amount) !== amount) fail(409, "IDEMPOTENCY_CONFLICT");
            const account = await client.query("SELECT id FROM billing_accounts WHERE user_id = $1 FOR UPDATE", [userId]);
            return { ...operation(row), balance: account.rowCount ? await balance(client, account.rows[0].id) : null };
        }
        const account = await client.query("SELECT id FROM billing_accounts WHERE user_id = $1 FOR UPDATE", [userId]);
        const accountId = account.rows[0]?.id;
        const currentBalance = accountId ? await balance(client, accountId) : null;
        const reason = !accountId ? "ACCOUNT_NOT_FOUND" : currentBalance < amount ? "INSUFFICIENT_FUNDS" : null;
        let withdrawalId = null;
        if (!reason) {
            const debit = await client.query("INSERT INTO balance_history(account_id, amount, order_id, kind) VALUES ($1, $2, $3, 'WITHDRAWAL') RETURNING id", [accountId, -amount, orderId]);
            withdrawalId = debit.rows[0].id;
        }
        const saved = await client.query(`INSERT INTO billing_operations(order_id, user_id, amount, status, reason, withdrawal_id)
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [orderId, userId, amount, reason ? "REJECTED" : "SUCCEEDED", reason, withdrawalId]);
        return { ...operation(saved.rows[0]), balance: reason ? currentBalance : currentBalance - amount };
    });
    ctx.status = result.status === "REJECTED" ? 409 : 200;
    ctx.body = result.status === "REJECTED" ? { ...result, code: result.reason } : result;
});

router.post("/refunds", async ctx => {
    const body = objectBody(ctx);
    const orderId = positiveInteger(body.orderId);
    if (Object.keys(body).some(key => key !== "orderId")) fail(400, "INVALID_REQUEST");
    ctx.body = await transaction(async client => {
        await lockOperation(client, orderId);
        const previous = await client.query("SELECT * FROM billing_operations WHERE order_id = $1", [orderId]);
        if (!previous.rowCount) fail(404, "WITHDRAWAL_NOT_FOUND");
        const row = previous.rows[0];
        if (row.status === "REJECTED") return operation(row);
        const accountId = await lockedAccount(client, safeNumber(row.user_id));
        const currentBalance = await balance(client, accountId);
        if (row.status === "COMPENSATED") return { ...operation(row), balance: currentBalance };
        const amount = BigInt(row.amount);
        const newBalance = safeNumber(BigInt(currentBalance) + amount);
        const refund = await client.query("INSERT INTO balance_history(account_id, amount, order_id, kind) VALUES ($1, $2, $3, 'REFUND') RETURNING id", [accountId, amount.toString(), orderId]);
        const saved = await client.query("UPDATE billing_operations SET status = 'COMPENSATED', refund_id = $2 WHERE order_id = $1 RETURNING *", [orderId, refund.rows[0].id]);
        return { ...operation(saved.rows[0]), balance: newBalance };
    });
});

module.exports = router;
