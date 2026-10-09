const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");

test("Warehouse integration", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
    const schema = `warehouse_test_${process.pid}_${Date.now()}`;
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
    await pool.query(await fs.readFile(path.join(__dirname, "../migrations/001-create-warehouse.sql"), "utf8"));
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
    const reserve = (orderId, productId, quantity) => call("/reservations", { orderId, productId, quantity });
    const cancel = orderId => call(`/reservations/${orderId}/cancel`, {});
    const stock = async productId => (await call(`/stock/${productId}`)).body.available;

    await t.test("reservation decreases stock once and rejects conflicting replays", async () => {
        const first = await reserve(100, 1, 3);
        assert.equal(first.status, 200);
        assert.equal(first.body.status, "SUCCEEDED");
        assert.equal(await stock(1), 7);
        assert.deepEqual(await reserve(100, 1, 3), first);
        assert.equal(await stock(1), 7);
        assert.equal((await reserve(100, 1, 4)).body.code, "IDEMPOTENCY_CONFLICT");
        assert.equal((await reserve(100, 2, 3)).status, 409);
        assert.deepEqual((await call("/operations/100")).body, first.body);
    });
    await t.test("compensation restores inventory once and prevents re-reservation", async () => {
        const first = await cancel(100);
        assert.equal(first.body.status, "COMPENSATED");
        assert.equal(await stock(1), 10);
        assert.deepEqual(await cancel(100), first);
        assert.equal((await reserve(100, 1, 3)).body.status, "COMPENSATED");
        assert.equal(await stock(1), 10);
    });
    await t.test("insufficient stock is a durable rejection, even after replenishment", async () => {
        const first = await reserve(101, 1, 11);
        assert.equal(first.status, 409);
        assert.equal(first.body.code, "OUT_OF_STOCK");
        assert.equal(await stock(1), 10);
        await pool.query("UPDATE warehouse_stock SET available = 20 WHERE product_id = 1");
        assert.deepEqual(await reserve(101, 1, 11), first);
        assert.equal((await cancel(101)).body.status, "REJECTED");
        assert.equal(await stock(1), 20);
        assert.equal((await call("/operations/101")).body.reason, "OUT_OF_STOCK");
    });
    await t.test("unknown products and operations, invalid quantities", async () => {
        assert.equal((await reserve(102, 999, 1)).body.code, "PRODUCT_NOT_FOUND");
        assert.equal((await call("/operations/102")).body.status, "REJECTED");
        assert.equal((await call("/operations/999")).status, 404);
        assert.equal((await cancel(999)).status, 404);
        for (const quantity of [null, 0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
            assert.equal((await reserve(103, 1, quantity)).status, 400);
        }
        assert.equal((await call("/operations/103")).status, 404);
    });
    await t.test("concurrent orders cannot reserve the last item twice", async () => {
        await pool.query("UPDATE warehouse_stock SET available = 1 WHERE product_id = 3");
        const responses = await Promise.all([reserve(200, 3, 1), reserve(201, 3, 1)]);
        assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
        assert.equal(await stock(3), 0);
        const winner = responses.find(r => r.status === 200).body.orderId;
        await Promise.all([cancel(winner), cancel(winner), cancel(winner)]);
        assert.equal(await stock(3), 1);
    });
    await t.test("concurrent identical requests change inventory once", async () => {
        const responses = await Promise.all(Array.from({ length: 5 }, () => reserve(300, 2, 2)));
        assert.ok(responses.every(r => r.status === 200 && r.body.status === "SUCCEEDED"));
        assert.equal(await stock(2), 18);
        const result = await pool.query("SELECT COUNT(*) AS n FROM warehouse_reservations WHERE order_id = 300");
        assert.equal(Number(result.rows[0].n), 1);
    });
    await t.test("a failure saving the operation rolls back the stock change", async () => {
        await pool.query(`CREATE FUNCTION fail_test_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.order_id = 400 THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$`);
        await pool.query("CREATE TRIGGER fail_test_reservation BEFORE INSERT ON warehouse_reservations FOR EACH ROW EXECUTE FUNCTION fail_test_reservation()");
        const before = await stock(2);
        assert.equal((await reserve(400, 2, 1)).status, 500);
        assert.equal(await stock(2), before);
        assert.equal((await call("/operations/400")).status, 404);
    });
});
