const Router = require("@koa/router");
const logger = require("../logger");
const authClient = require("../services/auth-client");
const profileClient = require("../services/profile-client");
const commerceClient = require("../services/commerce-client");
const { objectBody, requiredString } = require("../validation");

const router = new Router({ prefix: "/auth" });

function registrationProfile(ctx, body) {
    return {
        username: requiredString(ctx, body, "username").trim(),
        firstName: requiredString(ctx, body, "firstName").trim(),
        lastName: requiredString(ctx, body, "lastName").trim(),
        email: requiredString(ctx, body, "email", { maxLength: 320 }).trim(),
        phone:
            body.phone === undefined
                ? undefined
                : requiredString(ctx, body, "phone", {
                      maxLength: 32,
                  }).trim(),
    };
}

function copySessionCookies(ctx, cookies) {
    for (const cookie of cookies) {
        ctx.append("Set-Cookie", cookie);
    }
}

router.post("/register", async (ctx) => {
    const body = objectBody(ctx);
    const password = requiredString(ctx, body, "password", {
        minLength: 12,
        maxLength: 128,
    });
    const profile = registrationProfile(ctx, body);
    const user = await profileClient.createProfile(profile);

    try {
        await authClient.createCredentials({
            userId: user.id,
            username: user.username,
            password,
        });
    } catch (error) {
        // Registration spans two services. Deleting the newly created profile
        // compensates when credentials could not be persisted.
        try {
            await profileClient.deleteProfile(user.id);
        } catch (rollbackError) {
            logger.error(
                {
                    event: "registration_compensation_failed",
                    user_id: user.id,
                    error: rollbackError,
                },
                "Could not remove a profile after failed registration",
            );
        }

        throw error;
    }

    await commerceClient.createAccount(user.id);

    ctx.status = 201;
    ctx.set("Location", `/profile/${user.id}`);
    ctx.body = user;
    logger.info(
        { event: "user_registered", user_id: user.id },
        "User registered",
    );
});

router.post("/login", async (ctx) => {
    const body = objectBody(ctx);
    const credentials = {
        username: requiredString(ctx, body, "username").trim(),
        password: requiredString(ctx, body, "password", { maxLength: 128 }),
    };
    const response = await authClient.login(credentials);

    copySessionCookies(ctx, response.setCookies);
    ctx.status = response.status;
    ctx.body = response.body;
});

router.post("/logout", async (ctx) => {
    const response = await authClient.logout(ctx.get("cookie"));

    copySessionCookies(ctx, response.setCookies);
    ctx.status = response.status;
});

module.exports = router;
