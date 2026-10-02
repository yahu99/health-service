function objectBody(ctx) {
    const body = ctx.request.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
        ctx.throw(400, "Request body must be a JSON object");
    }

    return body;
}

function requiredString(ctx, body, field, options = {}) {
    const { minLength = 1, maxLength = 256 } = options;
    const value = body[field];

    if (
        typeof value !== "string" ||
        value.length < minLength ||
        value.length > maxLength
    ) {
        ctx.throw(
            400,
            `${field} must be a string between ${minLength} and ${maxLength} characters`,
        );
    }

    return value;
}

function positiveUserId(ctx, value) {
    const userId = Number(value);

    if (!Number.isSafeInteger(userId) || userId <= 0) {
        ctx.throw(400, "userId must be a positive integer");
    }

    return userId;
}

module.exports = {
    objectBody,
    positiveUserId,
    requiredString,
};
