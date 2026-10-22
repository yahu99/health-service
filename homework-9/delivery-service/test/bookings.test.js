const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");

test("Delivery integration", { skip: !process.env.TEST_DATABASE_URL }, async t => {
    const schema = `delivery_test_${process.pid}_${Date.now()}`;
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 10 });
    let server;
    t.after(async () => {
        if (server) await new Promise(resolve => server.close(resolve));
        await pool.end();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
    });
    await pool.query(await fs.readFile(path.join(__dirname, "../migrations/001-create-delivery.sql"), "utf8"));
    const dbPath = require.resolve("../src/db");
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
        exports: { pool, query: (...args) => pool.query(...args) } };
    server = require("../src/app").listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const base = `http://127.0.0.1:${server.address().port}/internal`;
    async function call(route, body) {
        const response = await fetch(`${base}${route}`, body === undefined ? {} : {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
    }
    const book = (orderId, deliverySlotId) => call("/bookings", { orderId, deliverySlotId });
    const cancel = orderId => call(`/bookings/${orderId}/cancel`, {});
    let slots;
    await t.test("future hourly slots are stable and replenished when missing", async () => {
        slots = (await call("/slots")).body.items;
        assert.equal(slots.length, 168);
        assert.ok(slots.every(s => Date.parse(s.startsAt) > Date.now() && Date.parse(s.endsAt) - Date.parse(s.startsAt) === 3600000 && s.availableCouriers === 1));
        assert.equal(new Set(slots.map(s => s.deliverySlotId)).size, 168);
        await pool.query("DELETE FROM delivery_slots WHERE id = $1", [slots[10].deliverySlotId]);
        const refreshed = (await call("/slots")).body.items;
        assert.deepEqual(refreshed, slots);
    });
    await t.test("only one booking fits a slot, but the next hour is independent", async () => {
        const first = await book(100, slots[0].deliverySlotId);
        assert.equal(first.status, 200);
        assert.equal(first.body.courierId, 1);
        assert.deepEqual(await book(100, slots[0].deliverySlotId), first);
        assert.equal((await book(100, slots[1].deliverySlotId)).body.code, "IDEMPOTENCY_CONFLICT");
        const denied = await book(101, slots[0].deliverySlotId);
        assert.equal(denied.status, 409);
        assert.equal(denied.body.code, "NO_COURIER_AVAILABLE");
        assert.equal((await book(102, slots[1].deliverySlotId)).status, 200);
        assert.equal((await call("/slots")).body.items[0].availableCouriers, 0);
        assert.deepEqual((await call("/operations/100")).body, first.body);
    });
    await t.test("compensation frees the slot once; old successes and failures stay final", async () => {
        const result = await cancel(100);
        assert.equal(result.body.status, "COMPENSATED");
        assert.deepEqual(await cancel(100), result);
        assert.equal((await book(100, slots[0].deliverySlotId)).body.status, "COMPENSATED");
        assert.equal((await book(101, slots[0].deliverySlotId)).body.code, "NO_COURIER_AVAILABLE");
        assert.equal((await cancel(101)).body.status, "REJECTED");
        assert.equal((await call("/slots")).body.items[0].availableCouriers, 1);
        assert.equal((await book(103, slots[0].deliverySlotId)).status, 200);
    });
    await t.test("unknown and expired slots are durable rejections", async () => {
        assert.equal((await book(200, 1)).body.code, "SLOT_NOT_FOUND");
        await pool.query("INSERT INTO delivery_slots VALUES (1, to_timestamp(3600), to_timestamp(7200))");
        assert.equal((await book(200, 1)).body.code, "SLOT_NOT_FOUND");
        assert.equal((await book(201, 1)).body.code, "SLOT_EXPIRED");
        assert.equal((await call("/operations/201")).body.status, "REJECTED");
        assert.equal((await call("/operations/999")).status, 404);
        assert.equal((await cancel(999)).status, 404);
        for (const slotId of [null, 0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
            assert.equal((await book(202, slotId)).status, 400);
        }
    });
    await t.test("concurrent requests choose one winner and cancellation frees capacity", async () => {
        const slot = slots[2].deliverySlotId;
        const responses = await Promise.all([book(300, slot), book(301, slot)]);
        assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
        const winner = responses.find(r => r.status === 200).body.orderId;
        await Promise.all([cancel(winner), cancel(winner)]);
        assert.equal((await book(302, slot)).status, 200);
    });
    await t.test("concurrent repeats produce one booking", async () => {
        const responses = await Promise.all(Array.from({ length: 5 }, () => book(400, slots[3].deliverySlotId)));
        assert.ok(responses.every(r => r.status === 200 && r.body.status === "SUCCEEDED"));
        const count = await pool.query("SELECT COUNT(*) AS n FROM delivery_bookings WHERE order_id = 400");
        assert.equal(Number(count.rows[0].n), 1);
    });
    await t.test("database uniqueness prevents two active bookings even without API checks", async () => {
        await assert.rejects(pool.query(`INSERT INTO delivery_bookings(order_id, slot_id, courier_id, status)
            VALUES (500, $1, 1, 'SUCCEEDED')`, [slots[3].deliverySlotId]), error => error.code === "23505");
    });
});
