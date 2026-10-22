function fail(status, code) {
    const error = new Error(code);
    error.status = status;
    error.apiCode = code;
    throw error;
}

function objectBody(ctx) {
    const body = ctx.request.body;
    if (!body || Array.isArray(body) || typeof body !== "object") fail(400, "INVALID_REQUEST");
    return body;
}

function positiveInteger(value) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) fail(400, "INVALID_REQUEST");
    return value;
}

function pathInteger(value) {
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) fail(400, "INVALID_REQUEST");
    return positiveInteger(Number(value));
}

function email(value) {
    if (typeof value !== "string" || value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail(400, "INVALID_REQUEST");
    return value;
}

function safeNumber(value) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) fail(409, "AMOUNT_LIMIT_EXCEEDED");
    return number;
}

module.exports = { fail, objectBody, positiveInteger, pathInteger, email, safeNumber };
