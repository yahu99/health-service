const assert = require("node:assert/strict");
const test = require("node:test");

test("BFF sends profile data to Profile Service over HTTP", async (t) => {
    const received = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
        const body = options.body ? JSON.parse(options.body) : null;
        received.push({ method: options.method, url, body });

        return new Response(
            JSON.stringify({
                id: 42,
                username: "alice",
                firstName: body?.firstName || "Alice",
            }),
            {
                status: 200,
                headers: { "content-type": "application/json" },
            },
        );
    };
    t.after(() => {
        global.fetch = originalFetch;
    });

    process.env.PROFILE_SERVICE_URL = "http://profile-service";
    const profileClient = require("../src/services/profile-client");
    const profile = await profileClient.getProfile(42);
    const updated = await profileClient.updateProfile(42, {
        firstName: "Updated",
    });

    assert.equal(profile.id, 42);
    assert.equal(updated.firstName, "Updated");
    assert.deepEqual(received, [
        {
            method: "GET",
            url: "http://profile-service/user/42",
            body: null,
        },
        {
            method: "PUT",
            url: "http://profile-service/user/42",
            body: { firstName: "Updated" },
        },
    ]);
});
