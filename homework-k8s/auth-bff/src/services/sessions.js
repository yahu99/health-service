const crypto = require("node:crypto");
const config = require("../config");
const db = require("../db");

const COOKIE_NAME = "session_id";

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest();
}

function tokenFromRequest(ctx) {
    return ctx.cookies.get(COOKIE_NAME, { signed: false }) || null;
}

async function create(userId) {
    const token = crypto.randomBytes(32).toString("base64url");
    const result = await db.query(
        `
            INSERT INTO auth_sessions (token_hash, user_id, expires_at)
            VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 second'))
            RETURNING expires_at AS "expiresAt"
        `,
        [hashToken(token), userId, config.sessionTtlSeconds],
    );

    return {
        token,
        expiresAt: result.rows[0].expiresAt,
    };
}

async function find(token) {
    const result = await db.query(
        `
            SELECT user_id AS "userId", expires_at AS "expiresAt"
            FROM auth_sessions
            WHERE token_hash = $1 AND expires_at > NOW()
        `,
        [hashToken(token)],
    );

    if (result.rowCount === 0) {
        return null;
    }

    return {
        userId: Number(result.rows[0].userId),
        expiresAt: result.rows[0].expiresAt,
    };
}

async function remove(token) {
    if (token) {
        await db.query("DELETE FROM auth_sessions WHERE token_hash = $1", [
            hashToken(token),
        ]);
    }
}

async function removeExpired() {
    await db.query("DELETE FROM auth_sessions WHERE expires_at <= NOW()");
}

function setCookie(ctx, token) {
    ctx.cookies.set(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: config.cookieSecure,
        signed: false,
        overwrite: true,
        maxAge: config.sessionTtlSeconds * 1000,
    });
}

function clearCookie(ctx) {
    ctx.cookies.set(COOKIE_NAME, null, {
        httpOnly: true,
        sameSite: "lax",
        secure: config.cookieSecure,
        signed: false,
        overwrite: true,
    });
}

module.exports = {
    clearCookie,
    create,
    find,
    remove,
    removeExpired,
    setCookie,
    tokenFromRequest,
};
