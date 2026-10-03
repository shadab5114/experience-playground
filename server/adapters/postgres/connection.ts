// Connection settings come only from the environment, so the same code runs
// against a local Postgres, Docker, or Aurora. No host or credentials are
// assumed. For Aurora/RDS, set DATABASE_SSL=on and DATABASE_SSL_CA_FILE to the
// RDS CA bundle. Put credentials in DATABASE_URL and leave sslmode out of it;
// SSL is controlled by DATABASE_SSL so there is one source of truth.
import { z } from "zod";

export interface DbConnection {
  url: string;
  ssl: boolean;
  caFile?: string;
}

const DbEnv = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_SSL: z.enum(["on", "off"]).default("off"),
  DATABASE_SSL_CA_FILE: z.string().min(1).optional(),
});

export function dbConnectionFromEnv(env: Record<string, string | undefined>): DbConnection {
  const parsed = DbEnv.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid database configuration: ${problems}`);
  }
  const { DATABASE_URL, DATABASE_SSL, DATABASE_SSL_CA_FILE } = parsed.data;
  return {
    url: DATABASE_URL,
    ssl: DATABASE_SSL === "on",
    ...(DATABASE_SSL_CA_FILE ? { caFile: DATABASE_SSL_CA_FILE } : {}),
  };
}
