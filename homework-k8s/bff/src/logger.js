const pino = require("pino");

module.exports = pino({
    level: process.env.LOG_LEVEL || "info",
    messageKey: "message",
    base: {
        service: process.env.SERVICE_NAME || "health-bff",
        environment: process.env.NODE_ENV || "development",
    },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: {
        level(label) {
            return { level: label.toUpperCase() };
        },
    },
    serializers: {
        error: pino.stdSerializers.err,
    },
    redact: {
        paths: [
            "password",
            "body.password",
            "request.body.password",
            "token",
            "headers.authorization",
            "headers.cookie",
        ],
        censor: "[REDACTED]",
    },
});
