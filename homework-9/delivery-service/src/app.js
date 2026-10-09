const Koa = require("koa");
const Router = require("@koa/router");
const { bodyParser } = require("@koa/bodyparser");
const db = require("./db");
const logger = require("./logger");
const router = require("./routes");
const app = new Koa();

app.use(async (ctx, next) => {
    const started = Date.now();
    try {
        await next();
    } catch (error) {
        ctx.status = error.status || (error.code === "23505" ? 409 : 500);
        ctx.body = { code: error.apiCode || (ctx.status === 409 ? "CONFLICT" : ctx.status < 500 ? "INVALID_REQUEST" : "INTERNAL_ERROR") };
        if (ctx.status >= 500) logger.error({ error }, "Request failed");
    } finally {
        logger.info({ method: ctx.method, path: ctx.path, status_code: ctx.status, duration_ms: Date.now() - started }, "HTTP request completed");
    }
});
app.use(bodyParser({ enableTypes: ["json"], jsonLimit: "64kb" }));
const health = new Router({ prefix: "/health" });
health.get("/live", (ctx) => { ctx.body = { status: "OK" }; });
health.get("/ready", async (ctx) => {
    try {
        await db.query("SELECT 1");
        ctx.body = { status: "OK" };
    } catch {
        ctx.status = 503;
        ctx.body = { status: "NOT_READY" };
    }
});
for (const routes of [health, router]) {
    app.use(routes.routes());
    app.use(routes.allowedMethods());
}
app.use((ctx) => { ctx.status = 404; ctx.body = { code: "NOT_FOUND" }; });
module.exports = app;
