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
    async search({ component, topic }) {
      return file.entries
        .filter((e) => e.component === component)
        // An entry with no topic applies to the whole component, so it always matches.
        .filter((e) => !topic || !e.topic || e.topic === topic)
        .map(({ sourceId, text }) => ({ sourceId, text }));
    },
  };
}
