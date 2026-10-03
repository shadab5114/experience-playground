// Enforces the import rule from the plan: core imports only itself, the
// contract package and zod. Anything else (adapters, packs, SQL drivers,
// vendor SDKs) fails here. Done as a test so no extra lint dependency is needed.
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const CORE_SRC = resolve(HERE);
const ALLOWED_PACKAGES = new Set(["zod", "@experience-agent/contract", "vitest"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith(".ts") ? [full] : [];
  });
}

function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const pattern = /(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) specs.push(match[1]!);
  return specs;
}

describe("core import boundary", () => {
  const files = sourceFiles(CORE_SRC).filter((f) => !f.endsWith(".test.ts"));

  test("core source files were found", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    test(`${file.slice(CORE_SRC.length + 1)} imports only allowed modules`, () => {
      const offenders: string[] = [];
      for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
        if (spec.startsWith(".")) {
          const target = resolve(dirname(file), spec);
          if (!target.startsWith(CORE_SRC)) offenders.push(`${spec} (escapes core/src)`);
        } else if (!ALLOWED_PACKAGES.has(spec)) {
          offenders.push(spec);
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});
