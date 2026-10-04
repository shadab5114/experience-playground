// GuidelineSource over the guidelines RAG app. Contract as agreed:
//   POST {baseUrl}/query   body: { query, collection_name }
//   200                    body: { answer }   (answer is markdown)
// The RAG app returns no document ids, so each answer gets a source id derived
// from the query. A refusal can cite that id, but it is not a document id.
import { createHash } from "node:crypto";
import { z } from "zod";
import type { GuidelineSource } from "@experience-agent/core";

// Only `answer` is read. It is markdown; the model reads it as text. Other fields are ignored.
const RagAnswer = z.object({
  answer: z.string(),
});

export interface RagGuidelineOptions {
  // Base URL of the RAG app, e.g. http://localhost:8080. The adapter adds /query.
  baseUrl: string;
  collection: string;
  // Sent as a bearer token only when set. The agreed contract does not name auth yet.
  apiKey?: string;
  timeoutMs: number;
  // Injected by tests; defaults to the global fetch.
  fetch?: typeof globalThis.fetch;
}

// The RAG app failed, timed out or answered in the wrong shape.
export class RagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RagError";
  }
}

export function createRagGuidelineSource(options: RagGuidelineOptions): GuidelineSource {
  const url = `${options.baseUrl.replace(/\/+$/, "")}/query`;
  const doFetch = options.fetch ?? globalThis.fetch;

  return {
    async search({ query }) {
      let response: Response;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
          },
          body: JSON.stringify({ query, collection_name: options.collection }),
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (err) {
        throw new RagError(`guidelines request failed: ${err instanceof Error ? err.name : "unknown"}`);
      }
      if (!response.ok) throw new RagError(`guidelines request returned ${response.status}`);

      const parsed = RagAnswer.safeParse(await response.json().catch(() => undefined));
      if (!parsed.success) throw new RagError("guidelines response did not match the agreed shape");

      const text = parsed.data.answer.trim();
      if (text === "") return [];
      const digest = createHash("sha256").update(`${options.collection}\n${query}`).digest("hex").slice(0, 12);
      return [{ sourceId: `rag-${digest}`, text }];
    },
  };
}
