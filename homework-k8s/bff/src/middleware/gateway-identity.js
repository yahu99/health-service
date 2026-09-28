async function gatewayIdentity(ctx, next) {
    const rawUserId = ctx.get("x-user-id");
    const userId = Number(rawUserId);

    if (!rawUserId || !Number.isSafeInteger(userId) || userId <= 0) {
        ctx.throw(401, "Authentication required");
    }

    ctx.state.auth = { userId };
    await next();
}

module.exports = gatewayIdentity;
