const Router = require("@koa/router");
const db = require("../db");
const logger = require("../logger");

const router = new Router({ prefix: "/health" });

router.get("/live", (ctx) => {
    ctx.body = { status: "OK" };
});

router.get("/ready", async (ctx) => {
    try {
        await db.query("SELECT 1");
        ctx.body = { status: "OK" };
    } catch (error) {
        logger.error(
            { event: "readiness_check_failed", error },
            "Readiness check failed",
        );
        ctx.status = 503;
        ctx.body = { status: "NOT_READY" };
    }
});

module.exports = router;
