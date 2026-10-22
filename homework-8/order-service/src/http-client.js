const config = require("./config");
const { fail } = require("./validation");

async function post(baseUrl, path, body) {
    let response;
    try {
        response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(config.serviceTimeoutMs),
        });
    } catch (error) {
        fail(error.name === "TimeoutError" ? 504 : 502, "UPSTREAM_UNAVAILABLE");
    }
    let data;
    try { data = await response.json(); } catch { fail(502, "INVALID_UPSTREAM_RESPONSE"); }
    if (!response.ok) {
        fail(response.status >= 500 ? 502 : response.status, data.code || "UPSTREAM_ERROR");
    }
    return data;
}

module.exports = { post };
