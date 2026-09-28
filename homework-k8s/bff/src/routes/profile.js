const Router = require("@koa/router");
const gatewayIdentity = require("../middleware/gateway-identity");
const requireProfileOwner = require("../middleware/require-profile-owner");
const profileClient = require("../services/profile-client");
const { objectBody } = require("../validation");

const router = new Router({ prefix: "/profile" });
const MUTABLE_PROFILE_FIELDS = ["firstName", "lastName", "email", "phone"];

router.get("/:userId", gatewayIdentity, requireProfileOwner, async (ctx) => {
    ctx.body = await profileClient.getProfile(ctx.state.profileUserId);
});

router.put("/:userId", gatewayIdentity, requireProfileOwner, async (ctx) => {
    const body = objectBody(ctx);
    const update = Object.fromEntries(
        MUTABLE_PROFILE_FIELDS.filter((field) => body[field] !== undefined).map(
            (field) => [field, body[field]],
        ),
    );

    if (Object.keys(update).length === 0) {
        ctx.throw(400, "At least one profile field must be provided");
    }

    ctx.body = await profileClient.updateProfile(
        ctx.state.profileUserId,
        update,
    );
});

module.exports = router;
