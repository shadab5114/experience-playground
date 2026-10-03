// Design-system settings for the VDS pack: the pinned catalog, the RAG
// collection, composition types and the system prompt wording. No URLs or
// keys live here; those come from env.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface PackSettings {
  catalogId: string;
  guidelineCollection: string;
  compositionTypes: string[];
  systemPrompt: string;
  // Local stand-in for the RAG endpoint, read by the file guideline adapter until the endpoint is wired.
  guidelineStubFile: string;
}

export function readPackSettings(): PackSettings {
  const pack = JSON.parse(readFileSync(join(HERE, "pack.json"), "utf8")) as {
    catalogId: string;
    guidelines: { collection: string };
    compositionTypes: string[];
  };
  return {
    catalogId: pack.catalogId,
    guidelineCollection: pack.guidelines.collection,
    compositionTypes: pack.compositionTypes,
    systemPrompt: readFileSync(join(HERE, "prompts/system.md"), "utf8"),
    guidelineStubFile: join(HERE, "guidelines.json"),
  };
}
