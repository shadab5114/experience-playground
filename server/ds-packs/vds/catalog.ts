// The VDS pack's CatalogSource. Reads the pinned pds-core package: its Zod
// schemas (one per catalog component) and its catalog.json for the names.
// Core only ever sees the CatalogSource port, never this package.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as pds from "@shadab5114/pds-core/schemas";
import type { CatalogEntry, CatalogSource, RuleSet } from "@experience-agent/core";
import { extras } from "./extras";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function createVdsCatalog(): CatalogSource {
  const pack = readJson<{ catalogId: string }>(join(HERE, "pack.json"));
  const rules = readJson<RuleSet>(join(HERE, "rules.json"));
  const catalogJson = readJson<{ components: Record<string, unknown> }>(
    require.resolve("@shadab5114/pds-core/catalog.json"),
  );

  const entries = new Map<string, CatalogEntry>();

  for (const name of Object.keys(catalogJson.components)) {
    const schema = (pds as Record<string, unknown>)[`${name}Schema`];
    if (!schema) throw new Error(`pds-core has no schema export for catalog component ${name}`);
    entries.set(name, {
      component: name,
      source: "catalog",
      allowedIn: "both",
      props: schema as CatalogEntry["props"],
    });
  }

  for (const extra of extras) {
    if (entries.has(extra.component)) {
      throw new Error(`Extra component ${extra.component} clashes with the pds catalog`);
    }
    entries.set(extra.component, {
      component: extra.component,
      source: "extra",
      allowedIn: extra.allowedIn,
      props: extra.props,
    });
  }

  return {
    catalogId: pack.catalogId,
    entry: (component) => entries.get(component),
    rules: () => rules,
  };
}
