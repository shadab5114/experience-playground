// Design-system settings for the VDS pack: the pinned catalog, the RAG
// collection, composition types and the system prompt wording. No URLs or
// keys live here; those come from env.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface PackSettings {
  catalogId: string;
  // The A2UI wire version this pack speaks. Authored records inherit it rather
  // than being asked for it.
  a2uiVersion: string;
  guidelineCollection: string;
  compositionTypes: string[];
  systemPrompt: string;
  // Local stand-in for the RAG endpoint, read by the file guideline adapter until the endpoint is wired.
  guidelineStubFile: string;
}

// Markdown comments (such as the PLACEHOLDER marker) are for people, not the model.
function stripComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, "").trim();
}

export function readPackSettings(): PackSettings {
  const pack = JSON.parse(readFileSync(join(HERE, "pack.json"), "utf8")) as {
    catalogId: string;
    a2uiVersion: string;
    guidelines: { collection: string };
    compositionTypes: string[];
  };
  return {
    catalogId: pack.catalogId,
    a2uiVersion: pack.a2uiVersion,
    guidelineCollection: pack.guidelines.collection,
    compositionTypes: pack.compositionTypes,
    systemPrompt: stripComments(readFileSync(join(HERE, "prompts/system.md"), "utf8")),
    guidelineStubFile: join(HERE, "guidelines.json"),
  };
}
