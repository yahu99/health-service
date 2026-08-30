const Router = require("@koa/router");
const { register } = require("../metrics");

const router = new Router();

router.get("/metrics", async (ctx) => {
    ctx.set("Content-Type", register.contentType);
    ctx.body = await register.metrics();
});

module.exports = router;
