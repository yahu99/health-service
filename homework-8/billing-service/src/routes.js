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

router.post("/withdrawals", async (ctx) => {
    const body = objectBody(ctx);
    const userId = positiveInteger(body.userId);
    const orderId = positiveInteger(body.orderId);
    const amount = positiveInteger(body.amount);
    ctx.body = await transaction(async (client) => {
        const accountId = await lockedAccount(client, userId);
        const previous = await client.query("SELECT id, account_id, amount FROM balance_history WHERE order_id = $1", [orderId]);
        const currentBalance = await balance(client, accountId);
        if (previous.rowCount) {
            const row = previous.rows[0];
            if (String(row.account_id) !== String(accountId) || BigInt(row.amount) !== -BigInt(amount)) fail(409, "CONFLICT");
            return { withdrawalId: safeNumber(row.id), balance: currentBalance };
        }
        if (currentBalance < amount) fail(409, "INSUFFICIENT_FUNDS");
        const result = await client.query("INSERT INTO balance_history(account_id, amount, order_id) VALUES ($1, $2, $3) RETURNING id", [accountId, -amount, orderId]);
        return { withdrawalId: safeNumber(result.rows[0].id), balance: currentBalance - amount };
    });
});

module.exports = router;
