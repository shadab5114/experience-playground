import { z } from "zod";
import { dbConnectionFromEnv, type DbConnection } from "@experience-agent/postgres";

export interface Config {
  db: DbConnection;
  DS_PACK: string;
  PORT: number;
  COMPOSITION_LIST_TTL_MS: number;
  CORS_ORIGINS: string[];
  // Model: the Anthropic API or the org's gateway. Set per environment.
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_API_KEY: string;
  MODEL_ID: string;
  MODEL_TIMEOUT_MS: number;
  // Only for keys not scoped to a workspace. Optional.
  ANTHROPIC_WORKSPACE_ID?: string;
  // Connections held by runs (one per active thread). Separate from the read pool, so
  // long runs cannot starve composition reads.
  RUN_LOCK_POOL_SIZE: number;
  // Guidelines RAG app. When RAG_BASE_URL is unset, the file stub is used instead.
  RAG_BASE_URL?: string;
  RAG_API_KEY?: string;
  RAG_TIMEOUT_MS: number;
}

// An empty env value counts as unset.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const Settings = z.object({
  DS_PACK: z.string().min(1).default("vds"),
  PORT: z.coerce.number().int().positive().default(8787),
  COMPOSITION_LIST_TTL_MS: z.coerce.number().int().nonnegative().default(30_000),
  // Comma-separated browser origins allowed to call the API (the playground dev server).
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://127.0.0.1:5173")
    .transform((v) => v.split(",").map((o) => o.trim()).filter(Boolean)),
  ANTHROPIC_BASE_URL: z.url(),
  ANTHROPIC_API_KEY: z.string().min(1),
  MODEL_ID: z.string().min(1),
  MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  ANTHROPIC_WORKSPACE_ID: optional(z.string().min(1)),
  RUN_LOCK_POOL_SIZE: z.coerce.number().int().positive().default(10),
  RAG_BASE_URL: optional(z.url()),
  RAG_API_KEY: optional(z.string().min(1)),
  RAG_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const settings = Settings.safeParse(env);
  if (!settings.success) {
    // Names the variable and the problem only. Never echoes a value, since some are keys.
    const problems = settings.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  return { db: dbConnectionFromEnv(env), ...settings.data };
}
