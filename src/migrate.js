const fs = require("node:fs/promises");
const path = require("node:path");
const { pool } = require("./db");

async function migrate() {
    const migrationPath = path.join(
        __dirname,
        "..",
        "migrations",
        "001-create-users.sql",
    );
    const migration = await fs.readFile(migrationPath, "utf8");
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        await client.query(migration);
        await client.query("COMMIT");
        console.log("Migration 001-create-users.sql completed");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

migrate()
    .catch((error) => {
        console.error("Migration failed", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end();
    });
