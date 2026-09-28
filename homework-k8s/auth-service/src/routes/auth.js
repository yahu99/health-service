const crypto = require("node:crypto");
const Router = require("@koa/router");
const db = require("../db");
const logger = require("../logger");
const { hashPassword, verifyPassword } = require("../security/password");
const sessions = require("../services/sessions");
const {
    objectBody,
    positiveUserId,
    requiredString,
} = require("../validation");

const router = new Router();
const DUMMY_SALT = crypto.randomBytes(16);
const DUMMY_HASH = crypto.randomBytes(64);

router.post("/internal/credentials", async (ctx) => {
    const body = objectBody(ctx);
    const userId = positiveUserId(ctx, body.userId);
    const username = requiredString(ctx, body, "username").trim();
    const password = requiredString(ctx, body, "password", {
        minLength: 12,
        maxLength: 128,
    });
    const { salt, hash } = await hashPassword(password);

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
        [userId, username, salt, hash],
    );

    ctx.status = 201;
    ctx.body = { userId, username };
    logger.info({ event: "credentials_created", user_id: userId }, "Credentials created");
});

router.post("/auth/login", async (ctx) => {
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

    // A dummy hash keeps response timing similar when the username is unknown.
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

router.post("/auth/logout", async (ctx) => {
    const token = sessions.tokenFromRequest(ctx);
    await sessions.remove(token);
    sessions.clearCookie(ctx);
    ctx.status = 204;
});

router.get("/auth/verify", async (ctx) => {
    const token = sessions.tokenFromRequest(ctx);

    if (!token) {
        ctx.throw(401, "Authentication required");
    }

    const session = await sessions.find(token);
    if (!session) {
        ctx.throw(401, "Invalid or expired session");
    }

    // ingress-nginx copies this header to the original upstream request.
    ctx.set("X-User-Id", String(session.userId));
    ctx.body = {
        userId: session.userId,
        expiresAt: session.expiresAt,
    };
});

module.exports = router;
