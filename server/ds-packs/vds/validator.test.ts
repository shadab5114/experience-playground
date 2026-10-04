import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { validate, type ValidationError } from "@experience-agent/core";
import { createVdsCatalog } from "./catalog";

const HERE = dirname(fileURLToPath(import.meta.url));
const catalog = createVdsCatalog();

// The catalog package this pack is built on. Written once here; everywhere else
// reads it out of pack.json.
const CATALOG_PACKAGE = (
  JSON.parse(readFileSync(join(HERE, "pack.json"), "utf8")) as { catalogPackage: { name: string } }
).catalogPackage.name;

type Expected = { layer: string; code: string; componentId?: string };
interface Fixture {
  name: string;
  kind: "composition" | "page";
  document: unknown;
  current?: unknown;
  expect: { errors: Expected[]; warnings: Expected[] };
}

const normalize = (f: ValidationError): Expected => ({
  layer: f.layer,
  code: f.code,
  ...(f.componentId !== undefined ? { componentId: f.componentId } : {}),
});
const sortKey = (f: Expected) => `${f.layer}|${f.code}|${f.componentId ?? ""}`;
const sorted = (xs: Expected[]) => [...xs].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

const fixtureDir = join(HERE, "golden/validator");
const fixtures = readdirSync(fixtureDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((file) => ({ file, fixture: JSON.parse(readFileSync(join(fixtureDir, file), "utf8")) as Fixture }));

describe("validator fixtures", () => {
  test("there are fixtures for every group", () => {
    const names = fixtures.map((f) => f.file);
    expect(names.filter((n) => n.startsWith("ref-"))).toHaveLength(14);
    expect(names.filter((n) => n.startsWith("ds-10"))).toHaveLength(5);
  });

  for (const { file, fixture } of fixtures) {
    test(`${file}: ${fixture.name}`, () => {
      const found = validate(fixture.document, { kind: fixture.kind, catalog, current: fixture.current });
      const errors = found.filter((f) => f.severity === "error").map(normalize);
      const warnings = found.filter((f) => f.severity === "warning").map(normalize);
      expect(sorted(errors)).toEqual(sorted(fixture.expect.errors));
      expect(sorted(warnings)).toEqual(sorted(fixture.expect.warnings));
    });
  }
});

/**
 * Everything the pack seeds must validate clean. These read `seed/*.json`
 * directly instead of keeping copies under `golden/validator`: a copy has to be
 * re-synced by hand every time a seed document changes, and a stale copy passes
 * while the thing actually seeded is broken.
 */
describe("seeded documents validate clean", () => {
  const seed = <T,>(file: string): T[] => JSON.parse(readFileSync(join(HERE, "seed", file), "utf8")) as T[];
  const compositions = seed<{ id: string; a2ui: unknown }>("compositions.json");
  const pages = seed<{ id: string; a2ui: unknown }>("page-templates.json");

  test("the seed files are not empty", () => {
    expect(compositions.length).toBeGreaterThan(0);
    expect(pages.length).toBeGreaterThan(0);
  });

  for (const { id, a2ui } of compositions) {
    test(`composition ${id}`, () => {
      expect(validate(a2ui, { kind: "composition", catalog })).toEqual([]);
    });
  }

  for (const { id, a2ui } of pages) {
    test(`page ${id}`, () => {
      expect(validate(a2ui, { kind: "page", catalog })).toEqual([]);
    });
  }
});

describe("catalog wiring", () => {
  // Resolved the same way the pack itself resolves it (createRequire), not by a
  // hardcoded ../../../node_modules path: a hardcoded path silently reads the
  // hoisted root copy even when this pack resolves a different one, which is the
  // exact drift the pinned-version test below exists to prevent.
  test("every catalog component resolves to a schema", () => {
    const catalogJson = JSON.parse(
      readFileSync(createRequire(import.meta.url).resolve(`${CATALOG_PACKAGE}/catalog.json`), "utf8"),
    ) as { components: Record<string, unknown> };
    for (const name of Object.keys(catalogJson.components)) {
      expect(catalog.entry(name), name).toBeDefined();
    }
  });

  test("Slot is registered as a page-only extra", () => {
    expect(catalog.entry("Slot")).toMatchObject({ source: "extra", allowedIn: "page" });
  });

  /**
   * One repo, one catalog. The playground renders against the copy of the
   * catalog package that the ROOT package.json resolves, and the validator
   * against the copy this pack resolves. If those differ, the server can reject
   * a document the renderer draws fine (or the reverse), and nothing else in the
   * suite notices — so the version is pinned exactly in three places and
   * compared here. A caret on the catalog package is the bug this catches.
   */
  test("the pinned catalog version is exact and the same in pack.json, the pack and the root", () => {
    const pack = JSON.parse(readFileSync(join(HERE, "pack.json"), "utf8")) as {
      catalogPackage: { name: string; version: string };
    };
    const packPkg = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const rootPkg = JSON.parse(readFileSync(join(HERE, "../../../package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const { name, version } = pack.catalogPackage;

    expect(version).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
    expect(packPkg.dependencies[name]).toBe(version);
    expect(rootPkg.dependencies[name], `root package.json must pin ${name} to exactly ${version}`).toBe(version);
  });

  // Asserts createVdsCatalog() READS pack.json rather than carrying its own
  // constant, so pack.json stays the only place the catalog identity is written.
  test("the catalog id comes from pack.json", () => {
    const pack = JSON.parse(readFileSync(join(HERE, "pack.json"), "utf8")) as { catalogId: string };
    expect(pack.catalogId).toMatch(/^https?:\/\//);
    expect(catalog.catalogId).toBe(pack.catalogId);
  });
});

describe("prop-invalid messages", () => {
  const docWith = (comp: Record<string, unknown>) => ({
    a2ui: [
      { version: "v0.9", createSurface: { surfaceId: "main", catalogId: catalog.catalogId } },
      { version: "v0.9", updateComponents: { surfaceId: "main", components: [{ id: "root", ...comp }] } },
    ],
  });
  const propErrors = (comp: Record<string, unknown>) =>
    validate(docWith(comp), { kind: "composition", catalog }).filter((f) => f.code === "prop-invalid");

  test("an invalid enum names the prop, the value and the allowed values", () => {
    const [e] = propErrors({ component: "Stack", direction: "diagonal", children: [] });
    expect(e?.message).toBe('Stack prop "direction" is "diagonal", which is not allowed');
    expect(e?.hint).toBe('allowed: "row", "column", "rowReverse", "columnReverse"');
  });

  test("a union that matches neither branch names the prop and its allowed forms", () => {
    const [e] = propErrors({ component: "Stack", direction: "column", children: 5 });
    expect(e?.message).toBe('Stack prop "children" has the wrong shape, got number');
    expect(e?.hint).toBe("allowed: array, object");
  });

  test("a missing required prop names the prop", () => {
    const [e] = propErrors({ component: "Text" });
    expect(e?.message).toBe('Text prop "children" is required');
    expect(e?.hint).toBeUndefined();
  });

  test("a wrong base type names the prop and the type it got", () => {
    const [e] = propErrors({ component: "TileContainer", children: [], background: 7 });
    expect(e?.message).toBe('TileContainer prop "background" must be string, got number');
  });
});
