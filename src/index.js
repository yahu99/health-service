const app = require("./app");
const config = require("./config");
const { pool } = require("./db");
const logger = require("./logger");

const server = app.listen(config.port, () => {
    logger.info(
        {
            event: "application_started",
            port: config.port,
        },
        "Application started",
    );
});

server.on("error", (error) => {
    logger.error(
        {
            event: "application_start_failed",
            error,
        },
        "Application failed to start",
    );
    process.exitCode = 1;
});

let isShuttingDown = false;

async function shutdown(signal) {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    logger.info(
        {
            event: "application_stopping",
            signal,
        },
        "Application stopping",
    );

    const forceShutdownTimer = setTimeout(() => {
        logger.error(
            {
                event: "application_shutdown_timeout",
            },
            "Graceful shutdown timed out",
        );
        process.exit(1);
    }, 10000);
    forceShutdownTimer.unref();

    server.close(async (error) => {
        if (error) {
            logger.error(
                {
                    event: "http_server_shutdown_failed",
                    error,
                },
                "Failed to close HTTP server",
            );
            process.exitCode = 1;
        }

        try {
            await pool.end();
        } catch (poolError) {
            logger.error(
                {
                    event: "database_pool_shutdown_failed",
                    error: poolError,
                },
                "Failed to close PostgreSQL pool",
            );
            process.exitCode = 1;
        } finally {
            clearTimeout(forceShutdownTimer);
            logger.info(
                {
                    event: "application_stopped",
                    exit_code: process.exitCode || 0,
                },
                "Application stopped",
            );
            process.exit();
        }
    });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
