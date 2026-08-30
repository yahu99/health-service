const Router = require("@koa/router");
const db = require("../db");
const logger = require("../logger");

const router = new Router();

function live(ctx) {
    ctx.body = {
        status: "OK",
    };
}

router.get("/health/", live);
router.get("/health/live", live);

router.get("/health/ready", async (ctx) => {
    try {
        await db.query("SELECT 1");
        ctx.body = {
            status: "OK",
        };
    } catch (error) {
        logger.error(
            {
                event: "database_readiness_check_failed",
                error,
            },
            "PostgreSQL readiness check failed",
        );
        ctx.status = 503;
        ctx.body = {
            status: "NOT_READY",
        };
    }
});

module.exports = router;
