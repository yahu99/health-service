const Koa = require("koa");
const { bodyParser } = require("@koa/bodyparser");
const healthRouter = require("./routes/health");
const usersRouter = require("./routes/users");

const app = new Koa();

app.use(async (ctx, next) => {
    try {
        await next();
    } catch (error) {
        const isUniqueViolation = error.code === "23505";

        ctx.status = isUniqueViolation ? 409 : error.status || 500;
        ctx.body = {
            code: ctx.status,
            message: isUniqueViolation
                ? "A user with this username or email already exists"
                : ctx.status === 500
                  ? "Internal server error"
                  : error.message,
        };

        if (ctx.status >= 500) {
            console.error(error);
        }
    }
});

app.use(async (ctx, next) => {
    await next();

    if (ctx.status === 404 && !ctx.body) {
        ctx.body = {
            code: 404,
            message: "Resource not found",
        };
        ctx.status = 404;
    }
});

app.use(
    bodyParser({
        enableTypes: ["json"],
        jsonLimit: "1mb",
    }),
);
app.use(healthRouter.routes());
app.use(healthRouter.allowedMethods());
app.use(usersRouter.routes());
app.use(usersRouter.allowedMethods());

module.exports = app;
