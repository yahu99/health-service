const config = require("../config");
const { request } = require("./http-client");

async function call(service, path, body) {
    const response = await request(config[`${service}ServiceUrl`], path, {
        method: body === undefined ? "GET" : "POST",
        body,
        serviceName: `${service} service`,
        timeoutMs: config.commerceTimeoutMs,
    });
    return response.body;
}

module.exports = {
    createAccount: (userId) => call("billing", "/internal/accounts", { userId }),
    getAccount: (userId) => call("billing", `/internal/accounts/by-user/${userId}`),
    deposit: (userId, amount) => call("billing", "/internal/deposits", { userId, amount }),
    createOrder: (userId, email, price) => call("order", "/internal/orders", { userId, email, price }),
    getOrder: (userId, orderId) => call("order", `/internal/orders/${orderId}?userId=${userId}`),
    getNotifications: (userId, orderId) => call("notification", `/internal/notifications?userId=${userId}${orderId === undefined ? "" : `&orderId=${orderId}`}`),
    readiness: () => Promise.all(["billing", "order", "notification"].map((service) => call(service, "/health/ready"))),
};
