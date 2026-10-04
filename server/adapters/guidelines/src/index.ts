// GuidelineSource adapters. The real RAG endpoint's request and response shape
// are not known yet, so the only adapter for now reads a local JSON file. When
// the endpoint arrives, add a second adapter here; the core and the pack do not change.
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { GuidelineSource } from "@experience-agent/core";

const GuidelineFile = z.object({
  entries: z.array(
    z.object({
      sourceId: z.string().min(1),
      component: z.string().min(1),
      topic: z.string().nullable().optional(),
      text: z.string().min(1),
    }),
  ),
});

export function createFileGuidelineSource(path: string): GuidelineSource {
  const file = GuidelineFile.parse(JSON.parse(readFileSync(path, "utf8")));
  return {
    // A stub cannot read a question, so it returns the passages for the components asked about.
    async search({ components }) {
      return file.entries
        .filter((e) => components.length === 0 || components.includes(e.component))
        .map(({ sourceId, text }) => ({ sourceId, text }));
    },
  };
}

export { createRagGuidelineSource, RagError, type RagGuidelineOptions } from "./rag";
