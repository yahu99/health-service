const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
};

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);

    return { salt, hash };
}

async function verifyPassword(password, salt, expectedHash) {
    const actualHash = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);

    return (
        actualHash.length === expectedHash.length &&
        crypto.timingSafeEqual(actualHash, expectedHash)
    );
}

module.exports = {
    hashPassword,
    verifyPassword,
};
