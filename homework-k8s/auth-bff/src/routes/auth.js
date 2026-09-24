const crypto = require("node:crypto");
const Router = require("@koa/router");
const db = require("../db");
const logger = require("../logger");
const { hashPassword, verifyPassword } = require("../security/password");
const profileClient = require("../services/profile-client");
const sessions = require("../services/sessions");
const { objectBody, requiredString } = require("../validation");

const router = new Router({ prefix: "/auth" });
const DUMMY_SALT = crypto.randomBytes(16);
const DUMMY_HASH = crypto.randomBytes(64);

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

router.post("/register", async (ctx) => {
    const body = objectBody(ctx);
    const password = requiredString(ctx, body, "password", {
        minLength: 12,
        maxLength: 128,
    });
    const profile = registrationProfile(ctx, body);

    // Expensive hashing happens before creating a remote profile so a local
    // hashing failure cannot leave an orphan in Profile Service.
    const { salt, hash } = await hashPassword(password);
    const user = await profileClient.createProfile(profile);

    try {
        await db.query(
            `
                INSERT INTO auth_credentials (
                    user_id,
                    username,
                    password_salt,
                    password_hash
                )
                VALUES ($1, $2, $3, $4)
            `,
            [user.id, user.username, salt, hash],
        );
    } catch (error) {
        // Registration spans two services. DELETE is a compensating action
        // when the second step fails after Profile Service created the user.
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
    const username = requiredString(ctx, body, "username").trim();
    const password = requiredString(ctx, body, "password", {
        maxLength: 128,
    });
    const result = await db.query(
        `
            SELECT
                user_id AS "userId",
                password_salt AS "passwordSalt",
                password_hash AS "passwordHash"
            FROM auth_credentials
            WHERE username = $1
        `,
        [username],
    );
    const credential = result.rows[0];

    // A dummy hash keeps the response timing similar when username is unknown.
    const passwordIsValid = await verifyPassword(
        password,
        credential?.passwordSalt || DUMMY_SALT,
        credential?.passwordHash || DUMMY_HASH,
    );

    if (!credential || !passwordIsValid) {
        ctx.throw(401, "Invalid username or password");
    }

    await sessions.removeExpired();
    const session = await sessions.create(Number(credential.userId));
    sessions.setCookie(ctx, session.token);

    ctx.body = {
        userId: Number(credential.userId),
        expiresAt: session.expiresAt,
    };
    logger.info(
        { event: "user_logged_in", user_id: Number(credential.userId) },
        "User logged in",
    );
});

router.post("/logout", async (ctx) => {
    const token = sessions.tokenFromRequest(ctx);
    await sessions.remove(token);
    sessions.clearCookie(ctx);
    ctx.status = 204;
});

module.exports = router;
