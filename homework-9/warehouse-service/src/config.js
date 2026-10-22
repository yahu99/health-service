function requiredEnvironmentVariable(name) {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Required environment variable ${name} is not set`);
    }

    return value;
}

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
    port: positiveIntegerEnvironmentVariable("PORT", 8006),
    database: {
        host: requiredEnvironmentVariable("DB_HOST"),
        port: positiveIntegerEnvironmentVariable("DB_PORT", 5432),
        database: requiredEnvironmentVariable("DB_NAME"),
        user: requiredEnvironmentVariable("DB_USER"),
        password: requiredEnvironmentVariable("DB_PASSWORD"),
        max: positiveIntegerEnvironmentVariable("DB_POOL_SIZE", 10),
        connectionTimeoutMillis: positiveIntegerEnvironmentVariable(
            "DB_CONNECTION_TIMEOUT_MS",
            3000,
        ),
        ssl:
            process.env.DB_SSL === "true"
                ? { rejectUnauthorized: false }
                : false,
    },
};
