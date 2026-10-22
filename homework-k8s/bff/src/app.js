const Koa = require("koa");
const { bodyParser } = require("@koa/bodyparser");
const logger = require("./logger");
const authRouter = require("./routes/auth");
const healthRouter = require("./routes/health");
const profileRouter = require("./routes/profile");
const commerceRouter = require("./routes/commerce");

const app = new Koa();
app.proxy = process.env.TRUST_PROXY === "true";

app.use(async (ctx, next) => {
    const startedAt = process.hrtime.bigint();

    try {
        await next();
    } finally {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        logger.info(
            {
                event: "http_request_completed",
                method: ctx.method,
                path: ctx.path,
                status_code: ctx.status,
                duration_ms: Number(durationMs.toFixed(3)),
            },
            "HTTP request completed",
        );
    }
});

app.use(async (ctx, next) => {
    try {
        await next();
    } catch (error) {
        ctx.status = error.status || 500;
        ctx.body = error.apiCode ? { code: error.apiCode } : {
            code: ctx.status,
            message: ctx.status === 500 ? "Internal server error" : error.message,
        };

        const log =
            ctx.status >= 500
                ? logger.error.bind(logger)
                : logger.warn.bind(logger);
        log(
            {
                event: "request_failed",
                method: ctx.method,
                path: ctx.path,
                status_code: ctx.status,
                error: ctx.status >= 500 ? error : undefined,
            },
            "Request failed",
        );
    }
});

app.use(bodyParser({ enableTypes: ["json"], jsonLimit: "64kb" }));

for (const router of [healthRouter, authRouter, profileRouter, commerceRouter]) {
    app.use(router.routes());
    app.use(router.allowedMethods());
}

app.use((ctx) => {
    ctx.status = 404;
    ctx.body = { code: 404, message: "Resource not found" };
});

module.exports = app;
