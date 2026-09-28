const assert = require("node:assert/strict");
const test = require("node:test");
const { hashPassword, verifyPassword } = require("../src/security/password");

test("the original password matches its hash", async () => {
    const password = "correct horse battery staple";
    const { salt, hash } = await hashPassword(password);

    assert.equal(await verifyPassword(password, salt, hash), true);
    assert.equal(await verifyPassword("incorrect password", salt, hash), false);
});

test("the same password receives different salts and hashes", async () => {
    const first = await hashPassword("a sufficiently long password");
    const second = await hashPassword("a sufficiently long password");

    assert.notDeepEqual(first.salt, second.salt);
    assert.notDeepEqual(first.hash, second.hash);
});
