const Router = require("@koa/router");
const db = require("../db");

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
        console.error("PostgreSQL readiness check failed", error.message);
        ctx.status = 503;
        ctx.body = {
            status: "NOT_READY",
        };
    }
});

module.exports = router;
