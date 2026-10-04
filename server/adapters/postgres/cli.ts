// Usage: npm run db:migrate | npm run db:samples (Node LTS with tsx; no Bun needed)
// Reads DATABASE_URL (plus optional DATABASE_SSL / DATABASE_SSL_CA_FILE) and DS_PACK.
// db:samples is insert-only, so running it against a database that already has
// content adds only what is missing and never overwrites authored records.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, dbConnectionFromEnv, migrate, importSamples } from "./index";

const HERE = dirname(fileURLToPath(import.meta.url));

const command = process.argv[2];
const pool = createPool(dbConnectionFromEnv(process.env));
try {
  if (command === "migrate") {
    const applied = await migrate(pool);
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "No pending migrations.");
  } else if (command === "samples") {
    const packName = process.env.DS_PACK ?? "vds";
    const counts = await importSamples(pool, join(HERE, "../../ds-packs", packName));
    console.log(`Imported ${packName} samples (new rows only):`, counts);
  } else {
    throw new Error(`Unknown command "${command}". Use migrate or samples.`);
  }
} finally {
  await pool.end();
}
