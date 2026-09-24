const sessions = require("../services/sessions");

async function authenticate(ctx, next) {
    const token = sessions.tokenFromRequest(ctx);

    if (!token) {
        ctx.throw(401, "Authentication required");
    }

    const session = await sessions.find(token);
    if (!session) {
        ctx.throw(401, "Invalid or expired session");
    }

    ctx.state.auth = session;
    await next();
}

module.exports = authenticate;
