const app = require("./app");
const config = require("./config");
const { pool } = require("./db");

const server = app.listen(config.port, () => {
    console.log(`Server started on port ${config.port}`);
});

let isShuttingDown = false;

async function shutdown(signal) {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    console.log(`${signal} received, shutting down`);

    const forceShutdownTimer = setTimeout(() => {
        console.error("Graceful shutdown timed out");
        process.exit(1);
    }, 10000);
    forceShutdownTimer.unref();

    server.close(async (error) => {
        if (error) {
            console.error("Failed to close HTTP server", error);
            process.exitCode = 1;
        }

        try {
            await pool.end();
        } catch (poolError) {
            console.error("Failed to close PostgreSQL pool", poolError);
            process.exitCode = 1;
        } finally {
            clearTimeout(forceShutdownTimer);
            process.exit();
        }
    });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
