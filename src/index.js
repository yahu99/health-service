const Koa = require("koa");
const Router = require("@koa/router");

const app = new Koa();
const router = new Router();

router.get("/health/", (ctx) => {
    ctx.body = {
        status: "OK",
    };
});

app.use(router.routes());
app.use(router.allowedMethods());

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});