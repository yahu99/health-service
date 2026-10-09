const { pool, query } = require("./db");
const config = require("./config");
const { post } = require("./http-client");
const { safeNumber } = require("./validation");
const logger = require("./logger");
const STEPS = ["BILLING", "WAREHOUSE", "DELIVERY"];
const REJECTIONS = {
    BILLING: ["INSUFFICIENT_FUNDS", "ACCOUNT_NOT_FOUND"],
    WAREHOUSE: ["OUT_OF_STOCK", "PRODUCT_NOT_FOUND"],
    DELIVERY: ["NO_COURIER_AVAILABLE", "SLOT_NOT_FOUND", "SLOT_EXPIRED"],
};

function command(order, step, compensate) {
    const orderId = safeNumber(order.id);
    if (step === "BILLING") return [config.billingServiceUrl,
        compensate ? "/internal/refunds" : "/internal/withdrawals",
        compensate ? { orderId } : { orderId, userId: safeNumber(order.user_id), amount: safeNumber(order.price) }];
    if (step === "WAREHOUSE") return [config.warehouseServiceUrl,
        compensate ? `/internal/reservations/${orderId}/cancel` : "/internal/reservations",
        compensate ? {} : { orderId, productId: safeNumber(order.product_id), quantity: safeNumber(order.quantity) }];
    return [config.deliveryServiceUrl,
        compensate ? `/internal/bookings/${orderId}/cancel` : "/internal/bookings",
        compensate ? {} : { orderId, deliverySlotId: safeNumber(order.delivery_slot_id) }];
}

async function callParticipant(order, step, compensate) {
    let result;
    try {
        result = await post(...command(order, step, compensate));
    } catch (error) {
        // Only a durable, matching participant rejection allows compensation.
        if (!compensate && error.status === 409 && error.details?.status === "REJECTED"
            && REJECTIONS[step].includes(error.details.reason)) result = error.details;
        else throw error;
    }
    const matches = result && result.orderId === safeNumber(order.id)
        && (step === "BILLING" ? result.userId === safeNumber(order.user_id) && result.amount === safeNumber(order.price)
            : step === "WAREHOUSE" ? result.productId === safeNumber(order.product_id) && result.quantity === safeNumber(order.quantity)
                : result.deliverySlotId === safeNumber(order.delivery_slot_id));
    const validStatus = compensate ? result?.status === "COMPENSATED"
        : result?.status === "SUCCEEDED" || (result?.status === "REJECTED" && REJECTIONS[step].includes(result.reason));
    if (!matches || !validStatus) throw new Error("INVALID_PARTICIPANT_RESPONSE");
    return result;
}

async function localTransaction(client, callback) {
    await client.query("BEGIN");
    try {
        await callback();
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}

async function advanceSaga(orderId) {
    const client = await pool.connect();
    let locked = false;
    let broken = false;
    const connectionFailed = () => { broken = true; };
    client.on?.("error", connectionFailed);
    const lockKey = `order-saga:${orderId}`;
    try {
        const lock = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked", [lockKey]);
        locked = lock.rows[0].locked;
        if (!locked) return;
        // A session lock owns this saga. The same connection is used throughout, without
        // holding a SQL transaction during HTTP. A lost connection cannot save stale progress.
        for (let iteration = 0; iteration < 8; iteration++) {
            const order = (await client.query("SELECT * FROM orders WHERE id = $1", [orderId])).rows[0];
            if (!order || !["PROCESSING", "COMPENSATING"].includes(order.status)) return;
            const due = (await client.query("SELECT next_attempt_at <= clock_timestamp() AS due FROM orders WHERE id = $1", [orderId])).rows[0].due;
            if (!due) return;
            const steps = (await client.query("SELECT * FROM order_saga_steps WHERE order_id = $1", [orderId])).rows;
            if (steps.length !== 3) throw new Error("INCOMPLETE_SAGA_STATE");
            const compensate = order.status === "COMPENSATING";
            const names = compensate ? [...STEPS].reverse() : STEPS;
            const current = names.map(name => steps.find(s => s.step === name)).find(s =>
                compensate ? ["SUCCEEDED", "COMPENSATING"].includes(s.status) : ["NOT_STARTED", "IN_PROGRESS"].includes(s.status));
            if (!current) {
                const complete = compensate
                    ? steps.every(s => ["NOT_STARTED", "REJECTED", "COMPENSATED"].includes(s.status))
                    : steps.every(s => s.status === "SUCCEEDED");
                if (!complete) throw new Error("INVALID_SAGA_STATE");
                await client.query("UPDATE orders SET status = $2 WHERE id = $1", [orderId, compensate ? "CANCELLED" : "CONFIRMED"]);
                return;
            }
            await client.query(`UPDATE order_saga_steps SET status = $3, attempts = attempts + 1,
                updated_at = NOW() WHERE order_id = $1 AND step = $2`,
            [orderId, current.step, compensate ? "COMPENSATING" : "IN_PROGRESS"]);
            let result;
            try {
                if (broken) throw new Error("SAGA_CONNECTION_LOST");
                result = await callParticipant(order, current.step, compensate);
            } catch (error) {
                const delay = Math.min(config.sagaRetryMaxMs, config.sagaRetryBaseMs * 2 ** Math.min(current.attempts, 10));
                await localTransaction(client, async () => {
                    await client.query("UPDATE order_saga_steps SET last_error = $3, updated_at = NOW() WHERE order_id = $1 AND step = $2",
                        [orderId, current.step, String(error.apiCode || error.message).slice(0, 500)]);
                    await client.query("UPDATE orders SET next_attempt_at = clock_timestamp() + ($2::double precision * INTERVAL '1 millisecond') WHERE id = $1", [orderId, delay]);
                });
                logger.warn({ orderId, step: current.step, compensate, retryInMs: delay }, "Saga step will be retried");
                return;
            }
            await localTransaction(client, async () => {
                await client.query("UPDATE order_saga_steps SET status = $3, last_error = $4, updated_at = NOW() WHERE order_id = $1 AND step = $2",
                    [orderId, current.step, compensate ? "COMPENSATED" : result.status, result.reason || null]);
                if (result.status === "REJECTED") {
                    await client.query("UPDATE orders SET status = 'COMPENSATING', reason = $2 WHERE id = $1", [orderId, result.reason]);
                }
            });
        }
    } catch (error) {
        broken = true;
        throw error;
    } finally {
        if (locked && !broken) {
            try { await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey]); }
            catch { broken = true; }
        }
        // Destroy a failed session to release any session-level lock.
        client.removeListener?.("error", connectionFailed);
        client.release(broken);
    }
}

async function runPending() {
    const result = await query(`SELECT id FROM orders WHERE status IN ('PROCESSING', 'COMPENSATING')
        AND next_attempt_at <= NOW() ORDER BY next_attempt_at, id LIMIT 20`);
    for (const row of result.rows) {
        try { await advanceSaga(safeNumber(row.id)); }
        catch (error) { logger.error({ orderId: row.id, error }, "Saga processing failed; progress is persisted"); }
    }
}

function startWorker() {
    let stopping = false;
    let timer;
    let running = Promise.resolve();
    function tick() {
        if (stopping) return;
        running = runPending().catch(error => logger.error({ error }, "Saga worker failed"))
            .finally(() => { if (!stopping) timer = setTimeout(tick, config.sagaPollMs); });
    }
    tick();
    return async () => { stopping = true; clearTimeout(timer); await running; };
}

module.exports = { advanceSaga, runPending, startWorker };
