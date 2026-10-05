const app = require("./app");
const config = require("./config");
const { pool } = require("./db");
const logger = require("./logger");

const server = app.listen(config.port, () => {
    logger.info(
        { event: "application_started", port: config.port },
        "Application started",
    );
});

let shuttingDown = false;

function shutdown(signal) {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;

    logger.info(
        { event: "application_stopping", signal },
        "Application stopping",
    );

    const forceExitTimer = setTimeout(() => {
        logger.error(
            { event: "application_shutdown_timeout" },
            "Graceful shutdown timed out",
        );
        process.exit(1);
    }, 10000);
    forceExitTimer.unref();

    server.close(async (error) => {
        if (error) {
            logger.error(
                { event: "http_server_shutdown_failed", error },
                "HTTP server shutdown failed",
            );
            process.exitCode = 1;
        }

        try {
            await pool.end();
        } finally {
            clearTimeout(forceExitTimer);
            process.exit();
        }
    });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
