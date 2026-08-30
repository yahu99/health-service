const client = require("prom-client");

const register = new client.Registry();

client.collectDefaultMetrics({
    register,
});

const httpRequestsTotal = new client.Counter({
    name: "http_requests_total",
    help: "Total number of HTTP requests",
    labelNames: ["method", "route", "status_code"],
    registers: [register],
});

const httpRequestDurationSeconds = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [register],
});

const httpRequestDurationSecondsMax = new client.Gauge({
    name: "http_request_duration_seconds_max",
    help: "Maximum HTTP request duration in seconds since the process started",
    labelNames: ["method", "route"],
    registers: [register],
});

const maximumDurations = new Map();

function routeLabel(ctx) {
    return ctx._matchedRoute || "unmatched";
}

function recordMaximumDuration(method, route, durationSeconds) {
    const key = `${method}:${route}`;
    const currentMaximum = maximumDurations.get(key) || 0;

    if (durationSeconds <= currentMaximum) {
        return;
    }

    maximumDurations.set(key, durationSeconds);
    httpRequestDurationSecondsMax.set(
        {
            method,
            route,
        },
        durationSeconds,
    );
}

async function metricsMiddleware(ctx, next) {
    if (ctx.path === "/metrics") {
        await next();
        return;
    }

    const startedAt = process.hrtime.bigint();

    await next();

    const durationSeconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    const method = ctx.method;
    const route = routeLabel(ctx);
    const statusCode = String(ctx.status);

    httpRequestsTotal.inc({
        method,
        route,
        status_code: statusCode,
    });
    httpRequestDurationSeconds.observe(
        {
            method,
            route,
            status_code: statusCode,
        },
        durationSeconds,
    );
    recordMaximumDuration(method, route, durationSeconds);
}

module.exports = {
    metricsMiddleware,
    register,
};
