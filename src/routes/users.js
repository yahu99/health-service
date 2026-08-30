const Router = require("@koa/router");
const db = require("../db");
const logger = require("../logger");

const router = new Router({
    prefix: "/user",
});

const USER_COLUMNS = `
    id,
    username,
    first_name AS "firstName",
    last_name AS "lastName",
    email,
    phone
`;

const USER_FIELDS = {
    username: "username",
    firstName: "first_name",
    lastName: "last_name",
    email: "email",
    phone: "phone",
};

function serializeUser(row) {
    return {
        ...row,
        id: Number(row.id),
    };
}

function requireObjectBody(ctx) {
    const body = ctx.request.body;

    if (!body || Array.isArray(body) || typeof body !== "object") {
        ctx.throw(400, "Request body must be a JSON object");
    }

    return body;
}

function validateString(ctx, body, field, options = {}) {
    const value = body[field];
    const { required = false, maxLength } = options;

    if (value === undefined) {
        if (required) {
            ctx.throw(400, `${field} is required`);
        }

        return;
    }

    if (typeof value !== "string" || value.trim().length === 0) {
        ctx.throw(400, `${field} must be a non-empty string`);
    }

    if (maxLength && value.length > maxLength) {
        ctx.throw(400, `${field} must be at most ${maxLength} characters`);
    }
}

function validateEmail(ctx, body, required) {
    validateString(ctx, body, "email", {
        required,
        maxLength: 320,
    });

    if (
        body.email !== undefined &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)
    ) {
        ctx.throw(400, "email must be a valid email address");
    }
}

function validateUser(ctx, body, required) {
    validateString(ctx, body, "username", {
        required,
        maxLength: 256,
    });
    validateString(ctx, body, "firstName", {
        required,
        maxLength: 256,
    });
    validateString(ctx, body, "lastName", {
        required,
        maxLength: 256,
    });
    validateEmail(ctx, body, required);
    validateString(ctx, body, "phone", {
        maxLength: 32,
    });
}

function parseUserId(ctx) {
    const userId = Number(ctx.params.userId);

    if (!Number.isSafeInteger(userId) || userId <= 0) {
        ctx.throw(400, "userId must be a positive integer");
    }

    return userId;
}

router.post("/", async (ctx) => {
    const body = requireObjectBody(ctx);
    validateUser(ctx, body, true);

    const result = await db.query(
        `
            INSERT INTO users (
                username,
                first_name,
                last_name,
                email,
                phone
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING ${USER_COLUMNS}
        `,
        [
            body.username.trim(),
            body.firstName.trim(),
            body.lastName.trim(),
            body.email.trim(),
            body.phone?.trim() || null,
        ],
    );

    const user = serializeUser(result.rows[0]);
    ctx.status = 201;
    ctx.set("Location", `/user/${user.id}`);
    ctx.body = user;
    logger.info(
        {
            event: "user_created",
            user_id: user.id,
        },
        "User created",
    );
});

router.get("/:userId", async (ctx) => {
    const userId = parseUserId(ctx);
    const result = await db.query(
        `
            SELECT ${USER_COLUMNS}
            FROM users
            WHERE id = $1
        `,
        [userId],
    );

    if (result.rowCount === 0) {
        ctx.throw(404, "User not found");
    }

    const user = serializeUser(result.rows[0]);
    ctx.body = user;
    logger.info(
        {
            event: "user_retrieved",
            user_id: user.id,
        },
        "User retrieved",
    );
});

router.put("/:userId", async (ctx) => {
    const userId = parseUserId(ctx);
    const body = requireObjectBody(ctx);
    validateUser(ctx, body, false);

    const fieldsToUpdate = Object.keys(USER_FIELDS).filter(
        (field) => body[field] !== undefined,
    );

    if (fieldsToUpdate.length === 0) {
        ctx.throw(400, "At least one user field must be provided");
    }

    const values = [userId];
    const assignments = fieldsToUpdate.map((field) => {
        const value =
            field === "phone"
                ? body[field].trim() || null
                : body[field].trim();
        values.push(value);

        return `${USER_FIELDS[field]} = $${values.length}`;
    });

    const result = await db.query(
        `
            UPDATE users
            SET ${assignments.join(", ")}
            WHERE id = $1
            RETURNING ${USER_COLUMNS}
        `,
        values,
    );

    if (result.rowCount === 0) {
        ctx.throw(404, "User not found");
    }

    const user = serializeUser(result.rows[0]);
    ctx.body = user;
    logger.info(
        {
            event: "user_updated",
            user_id: user.id,
        },
        "User updated",
    );
});

router.delete("/:userId", async (ctx) => {
    const userId = parseUserId(ctx);
    const result = await db.query(
        `
            DELETE FROM users
            WHERE id = $1
            RETURNING id
        `,
        [userId],
    );

    if (result.rowCount === 0) {
        ctx.throw(404, "User not found");
    }

    ctx.status = 204;
    logger.info(
        {
            event: "user_deleted",
            user_id: userId,
        },
        "User deleted",
    );
});

module.exports = router;
