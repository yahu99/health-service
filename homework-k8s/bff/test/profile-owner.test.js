const assert = require("node:assert/strict");
const test = require("node:test");
const requireProfileOwner = require("../src/middleware/require-profile-owner");

function context(authenticatedUserId, requestedUserId) {
    return {
        params: { userId: String(requestedUserId) },
        state: { auth: { userId: authenticatedUserId } },
        throw(status, message) {
            const error = new Error(message);
            error.status = status;
            throw error;
        },
    };
}

test("profile owner is allowed", async () => {
    const ctx = context(42, 42);
    let nextCalled = false;

    await requireProfileOwner(ctx, async () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(ctx.state.profileUserId, 42);
});

test("another user receives 403", async () => {
    const ctx = context(7, 42);

    await assert.rejects(
        requireProfileOwner(ctx, async () => {}),
        (error) => error.status === 403,
    );
});
