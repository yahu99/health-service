const Router = require("@koa/router");
const logger = require("../logger");
const authClient = require("../services/auth-client");
const profileClient = require("../services/profile-client");

const router = new Router({ prefix: "/health" });

router.get("/live", (ctx) => {
    ctx.body = { status: "OK" };
});

router.get("/ready", async (ctx) => {
    try {
        await Promise.all([authClient.readiness(), profileClient.readiness()]);
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
