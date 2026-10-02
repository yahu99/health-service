const assert = require("node:assert/strict");
const test = require("node:test");
const gatewayIdentity = require("../src/middleware/gateway-identity");

function context(headerValue) {
    return {
        state: {},
        get(name) {
            return name === "x-user-id" ? headerValue : "";
        },
        throw(status, message) {
            const error = new Error(message);
            error.status = status;
            throw error;
        },
    };
}

test("accepts a trusted positive user id", async () => {
    const ctx = context("42");
    let nextCalled = false;

    await gatewayIdentity(ctx, async () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.deepEqual(ctx.state.auth, { userId: 42 });
});

test("rejects a missing user id", async () => {
    await assert.rejects(
        gatewayIdentity(context(""), async () => {}),
        (error) => error.status === 401,
    );
});
