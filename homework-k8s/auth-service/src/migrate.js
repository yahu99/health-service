const fs = require("node:fs/promises");
const path = require("node:path");
const { pool } = require("./db");
const logger = require("./logger");

async function migrate() {
    const directory = path.join(__dirname, "..", "migrations");
    const migrations = (await fs.readdir(directory))
        .filter((name) => name.endsWith(".sql"))
        .sort();

    await pool.query(`
        CREATE TABLE IF NOT EXISTS auth_schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    for (const name of migrations) {
        const alreadyApplied = await pool.query(
            "SELECT 1 FROM auth_schema_migrations WHERE name = $1",
            [name],
        );
        if (alreadyApplied.rowCount > 0) {
            continue;
        }

        const sql = await fs.readFile(path.join(directory, name), "utf8");
        const client = await pool.connect();

        try {
            await client.query("BEGIN");
            await client.query(sql);
            await client.query(
                "INSERT INTO auth_schema_migrations (name) VALUES ($1)",
                [name],
            );
            await client.query("COMMIT");
            logger.info(
                { event: "migration_applied", migration: name },
                "Migration applied",
            );
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }
}

migrate()
    .catch((error) => {
        logger.error({ event: "migration_failed", error }, "Migration failed");
        process.exitCode = 1;
    })
    .finally(() => pool.end());
