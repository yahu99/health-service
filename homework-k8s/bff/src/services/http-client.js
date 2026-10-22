function upstreamError(status, message, apiCode) {
    const error = new Error(message);
    error.status = status;
    error.expose = status < 500;
    error.apiCode = apiCode;
    return error;
}

async function request(baseUrl, path, options = {}) {
    let response;

    try {
        const headers = { ...(options.headers || {}) };
        if (options.body) {
            headers["content-type"] = "application/json";
        }

        response = await fetch(`${baseUrl}${path}`, {
            method: options.method || "GET",
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined,
            signal: AbortSignal.timeout(options.timeoutMs),
        });
    } catch (error) {
        if (error.name === "TimeoutError") {
            throw upstreamError(504, `${options.serviceName} request timed out`);
        }

        throw upstreamError(502, `${options.serviceName} is unavailable`);
    }

    const text = await response.text();
    let body = null;

    if (text) {
        try {
            body = JSON.parse(text);
        } catch {
            throw upstreamError(502, `${options.serviceName} returned an invalid response`);
        }
    }

    if (!response.ok) {
        if (response.status < 500) {
            throw upstreamError(
                response.status,
                body?.message || `${options.serviceName} rejected the request`,
                typeof body?.code === "string" ? body.code : undefined,
            );
        }

        throw upstreamError(502, `${options.serviceName} request failed`);
    }

    return {
        body,
        status: response.status,
        setCookies:
            typeof response.headers.getSetCookie === "function"
                ? response.headers.getSetCookie()
                : response.headers.get("set-cookie")
                  ? [response.headers.get("set-cookie")]
                  : [],
    };
}

module.exports = { request };
