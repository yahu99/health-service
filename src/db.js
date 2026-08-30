const { Pool } = require("pg");
const config = require("./config");
const logger = require("./logger");

const pool = new Pool(config.database);

pool.on("error", (error) => {
    logger.error(
        {
            event: "database_pool_error",
            error,
        },
        "Unexpected PostgreSQL pool error",
    );
});

module.exports = {
    pool,
    query(text, parameters) {
        return pool.query(text, parameters);
    },
};
