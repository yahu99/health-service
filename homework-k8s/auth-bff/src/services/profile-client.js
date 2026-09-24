const config = require("../config");

function upstreamError(status, message) {
    const error = new Error(message);
    error.status = status;
    error.expose = status < 500;
    return error;
}

async function request(path, options = {}) {
    let response;

    try {
        response = await fetch(`${config.profileServiceUrl}${path}`, {
            method: options.method || "GET",
            headers: options.body
                ? { "content-type": "application/json" }
                : undefined,
            body: options.body ? JSON.stringify(options.body) : undefined,
            signal: AbortSignal.timeout(config.profileServiceTimeoutMs),
        });
    } catch (error) {
        if (error.name === "TimeoutError") {
            throw upstreamError(504, "Profile service request timed out");
        }

        throw upstreamError(502, "Profile service is unavailable");
    }

    const text = await response.text();
    let body = null;

    if (text) {
        try {
            body = JSON.parse(text);
        } catch {
            throw upstreamError(502, "Profile service returned an invalid response");
        }
    }

    if (!response.ok) {
        if (response.status < 500) {
            throw upstreamError(
                response.status,
                body?.message || "Profile service rejected the request",
            );
        }

        throw upstreamError(502, "Profile service request failed");
    }

    return body;
}

module.exports = {
    createProfile(profile) {
        return request("/user", { method: "POST", body: profile });
    },
    getProfile(userId) {
        return request(`/user/${userId}`);
    },
    updateProfile(userId, update) {
        return request(`/user/${userId}`, { method: "PUT", body: update });
    },
    deleteProfile(userId) {
        return request(`/user/${userId}`, { method: "DELETE" });
    },
    readiness() {
        return request("/health/ready");
    },
};
