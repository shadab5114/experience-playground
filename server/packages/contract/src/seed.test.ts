import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { A2UIDocumentSchema } from "./a2ui";

const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../ds-packs/vds/seed");
const load = (name: string): unknown[] => JSON.parse(readFileSync(join(SEED_DIR, name), "utf8")) as unknown[];

describe("seeded VDS documents fit the A2UI contract", () => {
  test("every composition's A2UI document parses", () => {
    const compositions = load("compositions.json");
    expect(compositions.length).toBeGreaterThan(0);
    for (const c of compositions) {
      const doc = (c as { id: string; a2ui: unknown });
      expect({ id: doc.id, ok: A2UIDocumentSchema.safeParse(doc.a2ui).success }).toEqual({ id: doc.id, ok: true });
    }
  });

  test("every page template's A2UI document parses", () => {
    for (const p of load("page-templates.json")) {
      const page = p as { id: string; a2ui: unknown };
      expect({ id: page.id, ok: A2UIDocumentSchema.safeParse(page.a2ui).success }).toEqual({ id: page.id, ok: true });
    }
  });
});
