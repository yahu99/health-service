const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");

test("Order catalog integration", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
    const schema = `order_catalog_test_${process.pid}_${Date.now()}`;
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    let server;
    t.after(async () => {
        if (server) await new Promise(resolve => server.close(resolve));
        await pool.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
    });
    const migration = name => fs.readFile(path.join(__dirname, "..", "migrations", name), "utf8");
    await pool.query(await migration("001-create-orders.sql"));
    await pool.query("INSERT INTO orders(user_id, email, price, status) VALUES (1, 'test@example.com', 777, 'PAID')");
    await pool.query(await migration("002-add-products.sql"));
    await pool.query(await migration("003-add-saga.sql"));
    function inject(modulePath, exports) {
        const id = require.resolve(modulePath);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    inject("../src/db", { pool, query: (...args) => pool.query(...args) });
    inject("../src/config", { billingServiceUrl: "billing", notificationServiceUrl: "notification" });
    const calls = [];
    inject("../src/saga", { advanceSaga: async (orderId) => { calls.push(orderId); } });
    server = require("../src/app").listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const base = `http://127.0.0.1:${server.address().port}/internal`;
    let key = 0;
    async function call(route, body) {
        const response = await fetch(`${base}${route}`, body === undefined ? {} : {
            method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": `catalog-${++key}` }, body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
    }
    const order = { userId: 1, email: "test@example.com", productId: 1, deliverySlotId: 500000 };
    const countOrders = async () => Number((await pool.query("SELECT COUNT(*) AS n FROM orders")).rows[0].n);

    await t.test("legacy orders retain their total without fabricated product data", async () => {
        const response = await call("/orders/1?userId=1");
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { orderId: 1, productId: null, quantity: null, unitPrice: null, deliverySlotId: null, price: 777, status: "PAID", reason: null, steps: [] });
    });
    await t.test("catalog and server-calculated total are saved before processing", async () => {
        const catalog = await call("/products");
        assert.equal(catalog.status, 200);
        assert.equal(catalog.body.items[0].unitPrice, 1000);
        const response = await call("/orders", { ...order, quantity: 3 });
        assert.equal(response.status, 202);
        assert.equal(response.body.price, 3000);
        assert.equal(response.body.unitPrice, 1000);
        assert.equal(response.body.quantity, 3);
        assert.equal(response.body.status, "PROCESSING");
        await pool.query("UPDATE products SET unit_price = 1200 WHERE id = 1");
        const saved = await call(`/orders/${response.body.orderId}?userId=1`);
        assert.equal(saved.body.price, 3000);
        assert.equal(saved.body.unitPrice, 1000);
        assert.equal((await call(`/orders/${response.body.orderId}?userId=2`)).status, 403);
    });
    await t.test("quantity defaults to one and new orders use the updated price", async () => {
        const response = await call("/orders", order);
        assert.equal(response.body.quantity, 1);
        assert.equal(response.body.price, 1200);
    });
    await t.test("unknown product, forged price, invalid quantity and overflow have no side effects", async () => {
        const beforeOrders = await countOrders();
        const beforeCalls = calls.length;
        const unknown = await call("/orders", { ...order, productId: 999 });
        assert.equal(unknown.status, 404);
        assert.equal(unknown.body.code, "PRODUCT_NOT_FOUND");
        for (const key of ["price", "unitPrice", "amount"]) {
            assert.equal((await call("/orders", { ...order, [key]: 1 })).status, 400);
        }
        for (const quantity of [null, 0, -1, 1.5, "2", Number.MAX_SAFE_INTEGER + 1]) {
            assert.equal((await call("/orders", { ...order, quantity })).status, 400);
        }
        const overflow = await call("/orders", { ...order, quantity: Number.MAX_SAFE_INTEGER });
        assert.equal(overflow.status, 409);
        assert.equal(overflow.body.code, "AMOUNT_LIMIT_EXCEEDED");
        assert.equal(await countOrders(), beforeOrders);
        assert.equal(calls.length, beforeCalls);
    });
    await t.test("new order and its three steps are saved together", async () => {
        const response = await call("/orders", { ...order, quantity: 2 });
        const saved = await call(`/orders/${response.body.orderId}?userId=1`);
        assert.equal(saved.body.price, 2400);
        assert.equal(saved.body.status, "PROCESSING");
        assert.deepEqual(saved.body.steps.map(s => s.step), ["BILLING", "WAREHOUSE", "DELIVERY"]);
        assert.ok(saved.body.steps.every(s => s.status === "NOT_STARTED"));
    });
});
