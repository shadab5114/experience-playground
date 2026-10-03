// Picks adapters from config and builds the dependencies the HTTP door needs.
// This is the only file that knows which concrete adapters are in use.
import { createPool, PostgresCompositionStore, pingDatabase } from "@experience-agent/postgres";
import { createAgentEngine, createPostgresCheckpointer } from "@experience-agent/langgraph";
import { makeNodes, type Logger } from "@experience-agent/core";
import { createAnthropicModel } from "@experience-agent/anthropic";
import { createFileGuidelineSource } from "@experience-agent/guidelines";
import { createVdsCatalog, readPackSettings } from "@experience-agent/vds-pack";
import type { Config } from "./config";
import { withListCache } from "./cache";
import type { AppDeps } from "./http/app";

// One JSON line per entry. Fields come from the caller and never include keys.
const logger: Logger = {
  warn: (event, fields) => console.warn(JSON.stringify({ level: "warn", event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ level: "error", event, ...fields })),
};

export async function wire(config: Config): Promise<{ deps: AppDeps; close: () => Promise<void> }> {
  if (config.DS_PACK !== "vds") throw new Error(`Unknown DS_PACK "${config.DS_PACK}"; only "vds" exists`);

  const pool = createPool(config.db);
  const store = new PostgresCompositionStore(pool, config.DS_PACK);
  const settings = readPackSettings();
  const checkpointer = await createPostgresCheckpointer(pool);

  const nodes = makeNodes({
    model: createAnthropicModel({
      baseURL: config.ANTHROPIC_BASE_URL,
      apiKey: config.ANTHROPIC_API_KEY,
      model: config.MODEL_ID,
      timeoutMs: config.MODEL_TIMEOUT_MS,
    }),
    catalog: createVdsCatalog(),
    guidelines: createFileGuidelineSource(settings.guidelineStubFile),
    compositions: store,
    pack: { systemPrompt: settings.systemPrompt, compositionTypes: settings.compositionTypes },
    log: logger,
  });

  return {
    deps: {
      corsOrigins: config.CORS_ORIGINS,
      compositions: withListCache(store, config.COMPOSITION_LIST_TTL_MS),
      pingDatabase: () => pingDatabase(pool),
      engine: createAgentEngine({ nodes, checkpointer }),
      log: logger,
    },
    close: () => pool.end(),
  };
}
