// Imports a design system pack's sample content. Insert-only: every statement is
// `on conflict ... do nothing`, so re-running can never clobber what the Studio
// authored, and a record deleted in the UI stays deleted unless it is imported
// into a fresh database. Postgres is the source of truth; ds-packs/<name>/seed
// is sample data only, read by this importer and nothing else at runtime.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type pg from "pg";
import { A2UIDocumentSchema } from "@experience-agent/contract";
import { documentComponents } from "@experience-agent/core";

const PackFile = z.object({
  name: z.string().min(1),
  a2uiVersion: z.literal("v0.9"),
  catalogId: z.string().min(1),
});

const SampleComposition = z.object({
  id: z.string(),
  name: z.string(),
  family: z.string().min(1),
  description: z.string().min(1),
  agentRules: z.string().optional(),
  type: z.string(),
  tags: z.array(z.string()),
  a2ui: A2UIDocumentSchema,
});

const SamplePageTemplate = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  agentRules: z.string().optional(),
  slots: z.array(z.string()),
  a2ui: A2UIDocumentSchema,
});

const SamplePlacement = z.object({
  compositionId: z.string(),
  pageTemplateId: z.string(),
  slotId: z.string(),
  variant: z.string().optional(),
  position: z.number().int(),
});

// Rows actually inserted. A second import of the same pack reports all zeroes.
export interface ImportCounts {
  compositions: number;
  pageTemplates: number;
  placements: number;
}

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  return schema.parse(raw);
}

export async function importSamples(pool: pg.Pool, packDir: string): Promise<ImportCounts> {
  const pack = await readJson(join(packDir, "pack.json"), PackFile);
  const seedDir = join(packDir, "seed");
  const compositions = await readJson(join(seedDir, "compositions.json"), z.array(SampleComposition));
  const pageTemplates = await readJson(join(seedDir, "page-templates.json"), z.array(SamplePageTemplate));
  const placements = await readJson(join(seedDir, "placements.json"), z.array(SamplePlacement));

  const counts: ImportCounts = { compositions: 0, pageTemplates: 0, placements: 0 };
  const client = await pool.connect();
  try {
    await client.query("begin");

    // Parents before children: pages and compositions, then placements.
    for (const p of pageTemplates) {
      const { rowCount } = await client.query(
        `insert into page_templates
           (id, ds_pack, name, description, agent_rules, slots, a2ui, origin)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, 'sample')
         on conflict (id) do nothing`,
        [
          p.id,
          pack.name,
          p.name,
          p.description ?? null,
          p.agentRules ?? null,
          p.slots,
          JSON.stringify(p.a2ui),
        ],
      );
      counts.pageTemplates += rowCount ?? 0;
    }

    for (const c of compositions) {
      // components_used is derived, never read from meta: a hand-written document
      // may omit meta.components or let it drift from what it actually renders.
      const { rowCount } = await client.query(
        `insert into compositions
           (id, ds_pack, name, family, description, agent_rules, type, tags,
            components_used, a2ui_version, a2ui, origin)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, 'sample')
         on conflict (id) do nothing`,
        [
          c.id,
          pack.name,
          c.name,
          c.family,
          c.description,
          c.agentRules ?? null,
          c.type,
          c.tags,
          documentComponents(c.a2ui),
          pack.a2uiVersion,
          JSON.stringify(c.a2ui),
        ],
      );
      counts.compositions += rowCount ?? 0;
    }

    for (const p of placements) {
      const { rowCount } = await client.query(
        `insert into placements (composition_id, page_template_id, slot_id, variant, position)
         values ($1, $2, $3, $4, $5)
         on conflict (composition_id, page_template_id, slot_id) do nothing`,
        [p.compositionId, p.pageTemplateId, p.slotId, p.variant ?? null, p.position],
      );
      counts.placements += rowCount ?? 0;
    }

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  return counts;
}
