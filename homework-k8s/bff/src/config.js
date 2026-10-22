function positiveIntegerEnvironmentVariable(name, defaultValue) {
    const rawValue = process.env[name];

    if (rawValue === undefined) {
        return defaultValue;
    }

    const value = Number(rawValue);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }

    return value;
}

module.exports = {
    port: positiveIntegerEnvironmentVariable("PORT", 8001),
    billingServiceUrl: (process.env.BILLING_SERVICE_URL || "http://health-billing-service").replace(/\/$/, ""),
    orderServiceUrl: (process.env.ORDER_SERVICE_URL || "http://health-order-service").replace(/\/$/, ""),
    notificationServiceUrl: (process.env.NOTIFICATION_SERVICE_URL || "http://health-notification-service").replace(/\/$/, ""),
    commerceTimeoutMs: positiveIntegerEnvironmentVariable("COMMERCE_TIMEOUT_MS", 15000),
    authServiceUrl: (process.env.AUTH_SERVICE_URL || "http://health-auth-service")
        .replace(/\/$/, ""),
    authServiceTimeoutMs: positiveIntegerEnvironmentVariable(
        "AUTH_SERVICE_TIMEOUT_MS",
        3000,
    ),
    profileServiceUrl: (process.env.PROFILE_SERVICE_URL || "http://health-service")
        .replace(/\/$/, ""),
    profileServiceTimeoutMs: positiveIntegerEnvironmentVariable(
        "PROFILE_SERVICE_TIMEOUT_MS",
        3000,
    ),
};
