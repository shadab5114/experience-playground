import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { validate, type ValidationError } from "@experience-agent/core";
import { createVdsCatalog } from "./catalog";

const HERE = dirname(fileURLToPath(import.meta.url));
const catalog = createVdsCatalog();

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
    expect(names.filter((n) => n.startsWith("seed-"))).toHaveLength(6);
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

describe("catalog wiring", () => {
  test("every pds catalog component resolves to a schema", () => {
    const catalogJson = JSON.parse(
      readFileSync(join(HERE, "../../../node_modules/@shadab5114/pds-core/catalog.json"), "utf8"),
    ) as { components: Record<string, unknown> };
    for (const name of Object.keys(catalogJson.components)) {
      expect(catalog.entry(name), name).toBeDefined();
    }
  });

  test("Slot is registered as a page-only extra", () => {
    expect(catalog.entry("Slot")).toMatchObject({ source: "extra", allowedIn: "page" });
  });

  test("the pinned pds-core version is exact and recorded in pack.json", () => {
    const pack = JSON.parse(readFileSync(join(HERE, "pack.json"), "utf8")) as { catalogPackage: { version: string } };
    const pkg = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@shadab5114/pds-core"]).toBe(pack.catalogPackage.version);
    expect(pack.catalogPackage.version).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });

  test("the catalog id comes from pack.json", () => {
    expect(catalog.catalogId).toBe("https://pdesign.dev/catalog/v1/catalog.json");
  });
});

describe("prop-invalid messages", () => {
  const docWith = (comp: Record<string, unknown>) => ({
    a2ui: [
      { version: "v0.9", createSurface: { surfaceId: "main", catalogId: "https://pdesign.dev/catalog/v1/catalog.json" } },
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
