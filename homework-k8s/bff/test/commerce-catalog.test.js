const test = require("node:test");
const assert = require("node:assert/strict");
const Koa = require("koa");
const { bodyParser } = require("@koa/bodyparser");

test("BFF catalog and order contract", async (t) => {
    process.env.ORDER_SERVICE_URL = "http://order-test";
    process.env.PROFILE_SERVICE_URL = "http://profile-test";
    process.env.DELIVERY_SERVICE_URL = "http://delivery-test";
    process.env.WAREHOUSE_SERVICE_URL = "http://warehouse-test";
    const originalFetch = global.fetch;
    const calls = [];
    let createStatus = 202;
    global.fetch = async (url, options) => {
        if (url.endsWith("/internal/orders")) assert.equal(options.headers["Idempotency-Key"], "bff-test");
        calls.push({ url, body: options.body ? JSON.parse(options.body) : null });
        const body = url.includes("profile-test") ? { email: "owner@example.com" }
            : url.includes("warehouse-test/internal/stock/") ? { productId: 1, available: 10 }
            : url.endsWith("/slots") ? { items: [{ deliverySlotId: 500000, availableCouriers: 1 }] }
            : url.endsWith("/products") ? { items: [{ productId: 1, name: "Книга", unitPrice: 1000 }] }
            : { orderId: 1, price: 2000, status: "PAID" };
        return new Response(JSON.stringify(body), { status: url.endsWith("/internal/orders") ? createStatus : 200 });
    };
    const app = new Koa();
    app.use(async (ctx, next) => {
        try { await next(); } catch (error) { ctx.status = error.status || 500; ctx.body = { code: error.apiCode }; }
    });
    app.use(bodyParser());
    const router = require("../src/routes/commerce");
    app.use(router.routes());
    const server = app.listen(0, "127.0.0.1");
    t.after(async () => {
        global.fetch = originalFetch;
        await new Promise(resolve => server.close(resolve));
    });
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    async function call(route, body, authenticated = true) {
        return originalFetch(`http://127.0.0.1:${server.address().port}${route}`, {
            method: body === undefined ? "GET" : "POST",
            headers: { "content-type": "application/json", "Idempotency-Key": "bff-test", ...(authenticated ? { "x-user-id": "42" } : {}) },
            body: body === undefined ? undefined : JSON.stringify({ deliverySlotId: 500000, ...body }),
        });
    }
    await t.test("forwards product and quantity with trusted user identity", async () => {
        const response = await call("/orders", { productId: 1, quantity: 2 });
        assert.equal(response.status, 202);
        assert.deepEqual(calls.at(-1), {
            url: "http://order-test/internal/orders",
            body: { userId: 42, email: "owner@example.com", productId: 1, quantity: 2, deliverySlotId: 500000 },
        });
        await call("/orders", { productId: 1 });
        assert.equal(calls.at(-1).body.quantity, 1);
    });
    await t.test("rejects client prices and invalid fields before calling upstream", async () => {
        const count = calls.length;
        for (const fields of [{ price: 1 }, { amount: 1 }, { unitPrice: 1 }, { userId: 7 }, { quantity: null }, { quantity: 0 }]) {
            assert.equal((await call("/orders", { productId: 1, ...fields })).status, 400);
        }
        assert.equal(calls.length, count);
    });
    await t.test("preserves completed repeat status and rejects missing idempotency key", async () => {
        createStatus = 200;
        assert.equal((await call("/orders", { productId: 1 })).status, 200);
        createStatus = 202;
        const count = calls.length;
        const response = await originalFetch(`http://127.0.0.1:${server.address().port}/orders`, {
            method: "POST", headers: { "content-type": "application/json", "x-user-id": "42" },
            body: JSON.stringify({ productId: 1, deliverySlotId: 500000 }),
        });
        assert.equal(response.status, 400);
        assert.equal(calls.length, count);
    });
    await t.test("catalog is forwarded and requires gateway identity", async () => {
        const response = await call("/products");
        assert.equal(response.status, 200);
        assert.equal((await response.json()).items[0].unitPrice, 1000);
        assert.equal(calls.at(-1).url, "http://order-test/internal/products");
        assert.equal((await call("/products", undefined, false)).status, 401);
    });
    await t.test("stock is forwarded for a valid product and requires identity", async () => {
        const response = await call("/products/1/stock");
        assert.equal(response.status, 200);
        assert.equal((await response.json()).available, 10);
        assert.equal(calls.at(-1).url, "http://warehouse-test/internal/stock/1");
        const count = calls.length;
        assert.equal((await call("/products/1/stock", undefined, false)).status, 401);
        assert.equal((await call("/products/0/stock")).status, 400);
        assert.equal(calls.length, count);
    });
    await t.test("delivery slots are forwarded and require gateway identity", async () => {
        const response = await call("/delivery/slots");
        assert.equal(response.status, 200);
        assert.equal((await response.json()).items[0].availableCouriers, 1);
        assert.equal(calls.at(-1).url, "http://delivery-test/internal/slots");
        const count = calls.length;
        assert.equal((await call("/delivery/slots", undefined, false)).status, 401);
        assert.equal(calls.length, count);
    });
});
