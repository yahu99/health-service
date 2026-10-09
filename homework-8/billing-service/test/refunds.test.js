const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");

// Use a disposable database: this suite creates and removes its own schema.
test("Billing refunds integration", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
    const schema = `billing_refund_test_${process.pid}_${Date.now()}`;
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        options: `-c search_path=${schema}`,
        max: 5,
    });
    let server;
    t.after(async () => {
        if (server) await new Promise((resolve) => server.close(resolve));
        await pool.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
    });
    const migration = (name) => fs.readFile(path.join(__dirname, "..", "migrations", name), "utf8");
    await pool.query(await migration("001-create-billing-tables.sql"));
    await pool.query("INSERT INTO billing_accounts(user_id) VALUES (1)");
    await pool.query("INSERT INTO balance_history(account_id, amount, order_id) VALUES (1, 2000, NULL), (1, -500, 100)");
    await pool.query(await migration("002-add-refunds.sql"));
    await pool.query(await migration("003-add-billing-operations.sql"));

    // Inject the isolated pool before loading the real HTTP application.
    const dbPath = require.resolve("../src/db");
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
        exports: { pool, query: (...args) => pool.query(...args) } };
    const app = require("../src/app");
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    const base = `http://127.0.0.1:${server.address().port}/internal`;
    async function call(route, body) {
        const response = await fetch(`${base}${route}`, body === undefined ? {} : {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
    }
    const accountBalance = async () => (await call("/accounts/by-user/1")).body.balance;

    await t.test("migration preserves historical deposits and withdrawals", async () => {
        assert.equal(await accountBalance(), 1500);
        const rows = await pool.query("SELECT kind FROM balance_history ORDER BY id");
        assert.deepEqual(rows.rows.map((row) => row.kind), ["DEPOSIT", "WITHDRAWAL"]);
    });
    await t.test("refund uses the original amount and preserves the debit", async () => {
        const response = await call("/refunds", { orderId: 100 });
        assert.equal(response.status, 200);
        assert.equal(response.body.status, "COMPENSATED");
        assert.equal(response.body.balance, 2000);
        const rows = await pool.query("SELECT amount FROM balance_history WHERE order_id = 100 ORDER BY id");
        assert.deepEqual(rows.rows.map((row) => Number(row.amount)), [-500, 500]);
    });
    await t.test("duplicate refund does not credit twice", async () => {
        const first = await call("/refunds", { orderId: 100 });
        const second = await call("/refunds", { orderId: 100 });
        assert.deepEqual(first, second);
        assert.equal(await accountBalance(), 2000);
    });
    await t.test("replayed withdrawal after refund cannot debit again", async () => {
        const response = await call("/withdrawals", { userId: 1, orderId: 100, amount: 500 });
        assert.equal(response.status, 200);
        assert.equal(response.body.status, "COMPENSATED");
        assert.equal(await accountBalance(), 2000);
        assert.equal((await call("/withdrawals", { userId: 1, orderId: 100, amount: 501 })).status, 409);
    });
    await t.test("missing debit and caller-supplied refund amount are rejected", async () => {
        assert.equal((await call("/refunds", { orderId: 999 })).status, 404);
        assert.equal((await call("/refunds", { orderId: 100, amount: 10000 })).status, 400);
        assert.equal((await call("/refunds", { orderId: -1 })).status, 400);
        assert.equal(await accountBalance(), 2000);
    });
    await t.test("new withdrawals and deposits still work", async () => {
        assert.equal((await call("/deposits", { userId: 1, amount: 100 })).status, 201);
        assert.equal((await call("/withdrawals", { userId: 1, orderId: 101, amount: 600 })).body.balance, 1500);
        assert.equal((await call("/withdrawals", { userId: 1, orderId: 101, amount: 600 })).body.balance, 1500);
        assert.equal((await call("/withdrawals", { userId: 1, orderId: 102, amount: 9999 })).status, 409);
    });
    await t.test("concurrent refunds create one credit", async () => {
        const responses = await Promise.all(Array.from({ length: 5 }, () => call("/refunds", { orderId: 101 })));
        assert.ok(responses.every((response) => response.status === 200));
        assert.equal(new Set(responses.map((response) => response.body.refundId)).size, 1);
        assert.equal(await accountBalance(), 2100);
        const count = await pool.query("SELECT COUNT(*) AS n FROM balance_history WHERE order_id = 101 AND kind = 'REFUND'");
        assert.equal(Number(count.rows[0].n), 1);
    });
});
