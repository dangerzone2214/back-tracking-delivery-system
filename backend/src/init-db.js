import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { seedAgentAccounts } from "./seed-agents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schema = await fs.readFile(path.resolve(__dirname, "../schema.sql"), "utf8");

await pool.query(schema);
await seedAgentAccounts();
await pool.end();

console.log("Database schema initialized.");
