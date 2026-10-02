const config = require("../config");
const { request } = require("./http-client");

async function profileRequest(path, options = {}) {
    const response = await request(config.profileServiceUrl, path, {
        ...options,
        serviceName: "Profile service",
        timeoutMs: config.profileServiceTimeoutMs,
    });

    return response.body;
}

module.exports = {
    createProfile(profile) {
        return profileRequest("/user", { method: "POST", body: profile });
    },
    getProfile(userId) {
        return profileRequest(`/user/${userId}`);
    },
    updateProfile(userId, update) {
        return profileRequest(`/user/${userId}`, { method: "PUT", body: update });
    },
    deleteProfile(userId) {
        return profileRequest(`/user/${userId}`, { method: "DELETE" });
    },
    readiness() {
        return profileRequest("/health/ready");
    },
};
