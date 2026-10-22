const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");

test("Order Saga over HTTP", { skip: !process.env.TEST_DATABASE_URL }, async t => {
    const root = process.env.SAGA_TEST_ROOT || path.resolve(__dirname, "../../..");
    const definitions = {
        billing: "homework-8/billing-service", warehouse: "homework-9/warehouse-service",
        delivery: "homework-9/delivery-service", order: "homework-8/order-service",
    };
    const services = {};
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const originalFetch = global.fetch;
    let loss = null;
    let outage = null;
    let holdWithdrawal = null;
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push(String(url));
        if (outage && String(url).includes(outage)) throw new Error("simulated outage");
        if (holdWithdrawal && String(url).endsWith("/withdrawals")) await holdWithdrawal.promise;
        const response = await originalFetch(url, options);
        if (loss && String(url).includes(loss)) {
            loss = null;
            await response.text();
            throw new Error("simulated lost response after commit");
        }
        return response;
    };
    t.after(async () => {
        global.fetch = originalFetch;
        for (const service of Object.values(services)) {
            if (service.server) await new Promise(resolve => service.server.close(resolve));
            await service.pool.end();
            await admin.query(`DROP SCHEMA ${service.schema} CASCADE`);
        }
        await admin.end();
    });
    function inject(filename, exports) {
        const id = require.resolve(filename);
        require.cache[id] = { id, filename: id, loaded: true, exports };
    }
    for (const [name, directory] of Object.entries(definitions)) {
        const folder = path.join(root, directory);
        const schema = `saga_${name}_${process.pid}_${Date.now()}`;
        await admin.query(`CREATE SCHEMA ${schema}`);
        const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 10 });
        const service = services[name] = { pool, schema, folder };
        for (const file of (await fs.readdir(path.join(folder, "migrations"))).filter(f => f.endsWith(".sql")).sort()) {
            await pool.query(await fs.readFile(path.join(folder, "migrations", file), "utf8"));
        }
        inject(path.join(folder, "src/db"), { pool, query: (...args) => pool.query(...args) });
        if (name === "order") inject(path.join(folder, "src/config"), {
            billingServiceUrl: services.billing.url, warehouseServiceUrl: services.warehouse.url,
            deliveryServiceUrl: services.delivery.url, serviceTimeoutMs: 500,
            sagaPollMs: 10, sagaRetryBaseMs: 10, sagaRetryMaxMs: 20,
        });
        service.server = require(path.join(folder, "src/app")).listen(0, "127.0.0.1");
        await new Promise((resolve, reject) => { service.server.once("listening", resolve); service.server.once("error", reject); });
        service.url = `http://127.0.0.1:${service.server.address().port}`;
    }
    let saga = require(path.join(services.order.folder, "src/saga"));
    async function call(service, route, body, key) {
        const response = await originalFetch(`${services[service].url}/internal${route}`, {
            method: body === undefined ? "GET" : "POST",
            headers: { "content-type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
    }
    const slots = (await call("delivery", "/slots")).body.items;
    const balance = async userId => (await call("billing", `/accounts/by-user/${userId}`)).body.balance;
    const stock = async () => (await call("warehouse", "/stock/1")).body.available;
    const get = async (id, userId) => (await call("order", `/orders/${id}?userId=${userId}`)).body;
    async function account(userId, amount = 10000) {
        await call("billing", "/accounts", { userId });
        if (amount) await call("billing", "/deposits", { userId, amount });
    }
    async function create(userId, slotIndex, key, fields = {}) {
        const response = await call("order", "/orders", {
            userId, email: `user${userId}@example.com`, productId: 1, quantity: 1,
            deliverySlotId: slots[slotIndex].deliverySlotId, ...fields,
        }, key);
        assert.equal(response.status, 202);
        return response.body.orderId;
    }
    async function retry(id) {
        await services.order.pool.query("UPDATE orders SET next_attempt_at = NOW() WHERE id = $1", [id]);
        await saga.runPending();
    }
    async function waitFor(predicate) {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            const value = await predicate();
            if (value) return value;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        throw new Error("Timed out waiting for saga progress");
    }
    const waitStatus = (id, userId, status) => waitFor(async () => {
        const order = await get(id, userId);
        return order.status === status ? order : null;
    });

    await t.test("creation starts Billing immediately but returns 202 without waiting for it", async () => {
        await account(10);
        let release;
        holdWithdrawal = { promise: new Promise(resolve => { release = resolve; }) };
        try {
            const id = await create(10, 7, "start-now");
            await waitFor(() => calls.some(url => url.endsWith("/withdrawals")));
            assert.equal((await get(id, 10)).status, "PROCESSING");
            assert.equal(await balance(10), 10000);
            release();
            holdWithdrawal = null;
            assert.equal((await waitStatus(id, 10, "CONFIRMED")).steps[0].status, "SUCCEEDED");
        } finally { release(); holdWithdrawal = null; }
    });

    await t.test("successful saga debits, reserves and books", async () => {
        await account(1);
        const id = await create(1, 0, "success");
        const result = await waitStatus(id, 1, "CONFIRMED");
        assert.equal(result.status, "CONFIRMED");
        assert.ok(result.steps.every(step => step.status === "SUCCEEDED"));
        assert.equal(await balance(1), 9000);
        assert.equal(await stock(), 8);
        assert.equal((await call("delivery", `/operations/${id}`)).body.status, "SUCCEEDED");
        const repeat = await call("order", "/orders", { userId: 1, email: "changed@example.com", productId: 1, deliverySlotId: slots[0].deliverySlotId }, "success");
        assert.equal(repeat.status, 200);
        assert.equal(repeat.body.orderId, id);
    });
    await t.test("billing refusal is durable after a later deposit and does not reserve stock", async () => {
        await account(2, 0);
        const before = await stock();
        const id = await create(2, 1, "no-money");
        await waitStatus(id, 2, "CANCELLED");
        assert.equal((await get(id, 2)).reason, "INSUFFICIENT_FUNDS");
        await call("billing", "/deposits", { userId: 2, amount: 5000 });
        const repeat = await call("billing", "/withdrawals", { userId: 2, orderId: id, amount: 1000 });
        assert.equal(repeat.status, 409);
        assert.equal(await balance(2), 5000);
        assert.equal(await stock(), before);
    });
    await t.test("warehouse refusal refunds billing", async () => {
        await account(3, 100000);
        const before = await stock();
        const id = await create(3, 2, "no-stock", { quantity: 50 });
        await waitStatus(id, 3, "CANCELLED");
        assert.equal((await get(id, 3)).reason, "OUT_OF_STOCK");
        assert.equal(await balance(3), 100000);
        assert.equal(await stock(), before);
        assert.equal((await call("delivery", `/operations/${id}`)).status, 404);
    });
    await t.test("delivery refusal compensates warehouse before billing", async () => {
        await account(4);
        const before = await stock();
        const start = calls.length;
        const id = await create(4, 0, "occupied");
        await waitStatus(id, 4, "CANCELLED");
        assert.equal((await get(id, 4)).reason, "NO_COURIER_AVAILABLE");
        assert.equal(await stock(), before);
        assert.equal(await balance(4), 10000);
        const sequence = calls.slice(start);
        assert.ok(sequence.findIndex(url => url.endsWith(`/reservations/${id}/cancel`)) < sequence.findIndex(url => url.endsWith("/refunds")));
    });
    await t.test("lost successful reply resumes from persisted state without double debit", async () => {
        await account(5);
        loss = "/withdrawals";
        const id = await create(5, 3, "lost-response");
        await waitFor(async () => (await get(id, 5)).steps[0].lastError);
        assert.equal((await get(id, 5)).status, "PROCESSING");
        assert.equal((await get(id, 5)).steps[0].status, "IN_PROGRESS");
        assert.equal(await balance(5), 9000);
        // Load a new processor instance; all workflow progress must come from the database.
        const filename = require.resolve(path.join(services.order.folder, "src/saga"));
        delete require.cache[filename];
        saga = require(filename);
        await retry(id);
        await waitStatus(id, 5, "CONFIRMED");
        assert.equal(await balance(5), 9000);
    });
    await t.test("lost delivery success is retried, never mistaken for rejection", async () => {
        await account(6);
        loss = "/bookings";
        const id = await create(6, 4, "delivery-lost");
        await waitFor(async () => (await get(id, 6)).steps[2].lastError);
        assert.equal((await get(id, 6)).status, "PROCESSING");
        assert.equal((await call("delivery", `/operations/${id}`)).body.status, "SUCCEEDED");
        await retry(id);
        await waitStatus(id, 6, "CONFIRMED");
    });
    await t.test("failed and lost compensation replies keep order unfinished until recovered", async () => {
        await account(7);
        const before = await stock();
        outage = "/refunds";
        const id = await create(7, 0, "refund-outage");
        await waitFor(async () => (await get(id, 7)).steps[0].lastError);
        assert.equal((await get(id, 7)).status, "COMPENSATING");
        assert.equal(await stock(), before);
        assert.equal(await balance(7), 9000);
        outage = null;
        loss = "/refunds";
        await retry(id);
        await waitFor(async () => (await balance(7)) === 10000);
        assert.equal((await get(id, 7)).status, "COMPENSATING");
        assert.equal(await balance(7), 10000);
        await retry(id);
        await waitStatus(id, 7, "CANCELLED");
        assert.equal(await balance(7), 10000);
    });
    await t.test("concurrent creation and processors do not duplicate effects; price snapshot is stable", async () => {
        await account(8);
        const body = { userId: 8, email: "user8@example.com", productId: 1, deliverySlotId: slots[5].deliverySlotId };
        const responses = await Promise.all(Array.from({ length: 3 }, () => call("order", "/orders", body, "parallel")));
        assert.ok(responses.every(r => r.status === 202));
        assert.equal(new Set(responses.map(r => r.body.orderId)).size, 1);
        const id = responses[0].body.orderId;
        await services.order.pool.query("UPDATE products SET unit_price = 1500 WHERE id = 1");
        assert.equal((await call("order", "/orders", body, "parallel")).body.price, 1000);
        assert.equal((await call("order", "/orders", { ...body, quantity: 2 }, "parallel")).status, 409);
        await Promise.all([saga.advanceSaga(id), saga.advanceSaga(id)]);
        await waitStatus(id, 8, "CONFIRMED");
        assert.equal(await balance(8), 9000);
        assert.equal((await call("order", `/orders/${id}?userId=1`)).status, 403);
        assert.equal((await call("order", "/orders", body)).status, 400);
    });
    await t.test("background worker discovers and completes persisted work", async () => {
        await account(9);
        outage = "/withdrawals";
        const id = await create(9, 6, "background");
        await waitFor(async () => (await get(id, 9)).steps[0].lastError);
        outage = null;
        await services.order.pool.query("UPDATE orders SET next_attempt_at = NOW() WHERE id = $1", [id]);
        const stop = saga.startWorker();
        try {
            const deadline = Date.now() + 5000;
            while ((await get(id, 9)).status === "PROCESSING" && Date.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            assert.equal((await get(id, 9)).status, "CONFIRMED");
        } finally { await stop(); }
    });
});
