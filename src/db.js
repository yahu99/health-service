const { Pool } = require("pg");
const config = require("./config");

const pool = new Pool(config.database);

pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error", error);
});

module.exports = {
    pool,
    query(text, parameters) {
        return pool.query(text, parameters);
    },
};
