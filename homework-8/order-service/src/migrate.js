const fs = require("node:fs/promises");
const path = require("node:path");
const { pool } = require("./db");
const logger = require("./logger");

async function migrate() {
    const directory = path.join(__dirname, "..", "migrations");
    const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        // Serialize concurrent runs of this service's migrations.
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["order_schema_migrations"]);
        await client.query("CREATE TABLE IF NOT EXISTS order_schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
        for (const file of files) {
            const applied = await client.query("SELECT 1 FROM order_schema_migrations WHERE name = $1", [file]);
            if (applied.rowCount) continue;
            await client.query(await fs.readFile(path.join(directory, file), "utf8"));
            await client.query("INSERT INTO order_schema_migrations (name) VALUES ($1)", [file]);
            logger.info({ migration: file }, "Migration applied");
        }
        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

migrate().catch((error) => {
    logger.error({ error }, "Migration failed");
    process.exitCode = 1;
}).finally(() => pool.end());
