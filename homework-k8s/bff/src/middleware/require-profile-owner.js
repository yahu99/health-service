const { userIdParameter } = require("../validation");

async function requireProfileOwner(ctx, next) {
    const requestedUserId = userIdParameter(ctx);

    if (ctx.state.auth.userId !== requestedUserId) {
        ctx.throw(403, "Access to another user's profile is forbidden");
    }

    ctx.state.profileUserId = requestedUserId;
    await next();
}

module.exports = requireProfileOwner;
