// Upserts a design system pack's seed data. Safe to run again: rows whose
// content is unchanged are not touched, so updated_at stays put.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type pg from "pg";
import { A2UIDocumentSchema } from "@experience-agent/contract";

const PackFile = z.object({
  name: z.string().min(1),
  a2uiVersion: z.literal("v0.9"),
  catalogId: z.string().min(1),
});

const SeedComposition = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  tags: z.array(z.string()),
  a2ui: A2UIDocumentSchema,
});

const SeedFlow = z.object({ id: z.string(), name: z.string() });

const SeedPageTemplate = z.object({
  id: z.string(),
  flowId: z.string(),
  name: z.string(),
  slots: z.array(z.string()),
  a2ui: A2UIDocumentSchema,
});

const SeedPlacement = z.object({
  compositionId: z.string(),
  pageTemplateId: z.string(),
  slotId: z.string(),
  variant: z.string().optional(),
  position: z.number().int(),
});

export interface SeedCounts {
  compositions: number;
  flows: number;
  pageTemplates: number;
  placements: number;
}

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
  return schema.parse(raw);
}

export async function seedPack(pool: pg.Pool, packDir: string): Promise<SeedCounts> {
  const pack = await readJson(join(packDir, "pack.json"), PackFile);
  const seedDir = join(packDir, "seed");
  const compositions = await readJson(join(seedDir, "compositions.json"), z.array(SeedComposition));
  const flows = await readJson(join(seedDir, "flows.json"), z.array(SeedFlow));
  const pageTemplates = await readJson(join(seedDir, "page-templates.json"), z.array(SeedPageTemplate));
  const placements = await readJson(join(seedDir, "placements.json"), z.array(SeedPlacement));

  const client = await pool.connect();
  try {
    await client.query("begin");

    // Parents before children: flows, pages, compositions, then placements.
    for (const f of flows) {
      await client.query(
        `insert into flows (id, ds_pack, name) values ($1, $2, $3)
         on conflict (id) do update set ds_pack = excluded.ds_pack, name = excluded.name
         where (flows.ds_pack, flows.name) is distinct from (excluded.ds_pack, excluded.name)`,
        [f.id, pack.name, f.name],
      );
    }

    for (const p of pageTemplates) {
      await client.query(
        `insert into page_templates (id, flow_id, ds_pack, name, slots, a2ui)
         values ($1, $2, $3, $4, $5, $6::jsonb)
         on conflict (id) do update set
           flow_id = excluded.flow_id, ds_pack = excluded.ds_pack, name = excluded.name,
           slots = excluded.slots, a2ui = excluded.a2ui
         where (page_templates.flow_id, page_templates.ds_pack, page_templates.name,
                page_templates.slots, page_templates.a2ui)
               is distinct from
               (excluded.flow_id, excluded.ds_pack, excluded.name, excluded.slots, excluded.a2ui)`,
        [p.id, p.flowId, pack.name, p.name, p.slots, JSON.stringify(p.a2ui)],
      );
    }

    for (const c of compositions) {
      await client.query(
        `insert into compositions (id, ds_pack, name, type, tags, components_used, a2ui_version, a2ui)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         on conflict (id) do update set
           ds_pack = excluded.ds_pack, name = excluded.name, type = excluded.type,
           tags = excluded.tags, components_used = excluded.components_used,
           a2ui_version = excluded.a2ui_version, a2ui = excluded.a2ui, updated_at = now()
         where (compositions.ds_pack, compositions.name, compositions.type, compositions.tags,
                compositions.components_used, compositions.a2ui_version, compositions.a2ui)
               is distinct from
               (excluded.ds_pack, excluded.name, excluded.type, excluded.tags,
                excluded.components_used, excluded.a2ui_version, excluded.a2ui)`,
        [
          c.id,
          pack.name,
          c.name,
          c.type,
          c.tags,
          c.a2ui.meta?.components ?? [],
          pack.a2uiVersion,
          JSON.stringify(c.a2ui),
        ],
      );
    }

    for (const p of placements) {
      await client.query(
        `insert into placements (composition_id, page_template_id, slot_id, variant, position)
         values ($1, $2, $3, $4, $5)
         on conflict (composition_id, page_template_id, slot_id) do update set
           variant = excluded.variant, position = excluded.position
         where (placements.variant, placements.position) is distinct from (excluded.variant, excluded.position)`,
        [p.compositionId, p.pageTemplateId, p.slotId, p.variant ?? null, p.position],
      );
    }

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  return {
    compositions: compositions.length,
    flows: flows.length,
    pageTemplates: pageTemplates.length,
    placements: placements.length,
  };
}
