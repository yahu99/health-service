const config = require("../config");
const { request } = require("./http-client");

function authRequest(path, options = {}) {
    return request(config.authServiceUrl, path, {
        ...options,
        serviceName: "Auth service",
        timeoutMs: config.authServiceTimeoutMs,
    });
}

module.exports = {
    createCredentials(credentials) {
        return authRequest("/internal/credentials", {
            method: "POST",
            body: credentials,
        });
    },
    login(credentials) {
        return authRequest("/auth/login", {
            method: "POST",
            body: credentials,
        });
    },
    logout(cookie) {
        return authRequest("/auth/logout", {
            method: "POST",
            headers: cookie ? { cookie } : {},
        });
    },
    readiness() {
        return authRequest("/health/ready");
    },
};
