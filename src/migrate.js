const fs = require("node:fs/promises");
const path = require("node:path");
const { pool } = require("./db");
const logger = require("./logger");

const MIGRATION_NAME = "001-create-users.sql";

async function migrate() {
    logger.info(
        {
            event: "migration_started",
            migration: MIGRATION_NAME,
        },
        "Migration started",
    );

    const migrationPath = path.join(
        __dirname,
        "..",
        "migrations",
        MIGRATION_NAME,
    );
    const migration = await fs.readFile(migrationPath, "utf8");
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        await client.query(migration);
        await client.query("COMMIT");
        logger.info(
            {
                event: "migration_completed",
                migration: MIGRATION_NAME,
            },
            "Migration completed",
        );
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

migrate()
    .catch((error) => {
        logger.error(
            {
                event: "migration_failed",
                migration: MIGRATION_NAME,
                error,
            },
            "Migration failed",
        );
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
