const Router = require("@koa/router");
const gatewayIdentity = require("../middleware/gateway-identity");
const commerce = require("../services/commerce-client");
const profile = require("../services/profile-client");
const { objectBody } = require("../validation");
const router = new Router();

function positiveInteger(ctx, value) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        const error = new Error("Expected a positive integer");
        error.status = 400;
        error.apiCode = "INVALID_REQUEST";
        throw error;
    }
    return value;
}

function pathInteger(ctx, value) {
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return positiveInteger(ctx, null);
    return positiveInteger(ctx, Number(value));
}

router.get("/billing/account", gatewayIdentity, async (ctx) => {
    ctx.body = await commerce.getAccount(ctx.state.auth.userId);
});

router.post("/billing/deposits", gatewayIdentity, async (ctx) => {
    const amount = positiveInteger(ctx, objectBody(ctx).amount);
    ctx.body = await commerce.deposit(ctx.state.auth.userId, amount);
    ctx.status = 201;
});

router.get("/products", gatewayIdentity, async (ctx) => {
    ctx.body = await commerce.getProducts();
});

router.get("/products/:productId/stock", gatewayIdentity, async (ctx) => {
    const productId = pathInteger(ctx, ctx.params.productId);
    ctx.body = await commerce.getStock(productId);
});

router.get("/delivery/slots", gatewayIdentity, async (ctx) => {
    ctx.body = await commerce.getDeliverySlots();
});

router.post("/orders", gatewayIdentity, async (ctx) => {
    const body = objectBody(ctx);
    if (Object.keys(body).some((key) => !["productId", "quantity", "deliverySlotId"].includes(key))) positiveInteger(ctx, null);
    const productId = positiveInteger(ctx, body.productId);
    const quantity = positiveInteger(ctx, body.quantity === undefined ? 1 : body.quantity);
    const deliverySlotId = positiveInteger(ctx, body.deliverySlotId);
    const idempotencyKey = ctx.get("Idempotency-Key");
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) {
        const error = new Error("Invalid Idempotency-Key");
        error.status = 400;
        error.apiCode = "INVALID_IDEMPOTENCY_KEY";
        throw error;
    }
    const userId = ctx.state.auth.userId;
    const user = await profile.getProfile(userId);
    const response = await commerce.createOrder(userId, user.email, productId, quantity, deliverySlotId, idempotencyKey);
    ctx.body = response.body;
    ctx.status = response.status;
});

router.get("/orders/:orderId", gatewayIdentity, async (ctx) => {
    const orderId = pathInteger(ctx, ctx.params.orderId);
    ctx.body = await commerce.getOrder(ctx.state.auth.userId, orderId);
});

router.get("/notifications", gatewayIdentity, async (ctx) => {
    const orderId = ctx.query.orderId === undefined ? undefined : pathInteger(ctx, ctx.query.orderId);
    ctx.body = await commerce.getNotifications(ctx.state.auth.userId, orderId);
});

module.exports = router;
