// AuthoringStore over Postgres. All SQL for Studio writes lives here.
//
// Three invariants every write upholds:
//  - Derived columns are computed from the document, never taken from the caller
//    (`components_used`, a page's `slots`).
//  - `origin` is set on insert and left alone on update: it says where a row came
//    from, not whether anyone has edited it since. The delete dialog depends on
//    that - re-importing samples can restore a 'sample' id and never an 'authored' one.
//  - `ds_pack` is set the way the sample importer sets it, so authored rows are
//    scoped to a pack exactly like imported ones.
import type pg from "pg";
import { documentComponents, documentSlots, type AuthoringStore } from "@experience-agent/core";
import type {
  A2UIDocument,
  CompositionInput,
  CompositionRecord,
  CompositionVersionSummary,
  DeleteImpact,
  PageTemplateInput,
  PageTemplateRecord,
  PlacementInput,
  PlacementKey,
  PlacementRecord,
  RecordOrigin,
  SavedBy,
} from "@experience-agent/contract";

interface CompositionRow {
  id: string;
  name: string;
  family: string | null;
  description: string | null;
  agent_rules: string | null;
  type: string;
  tags: string[];
  components_used: string[];
  a2ui_version: string;
  a2ui: A2UIDocument;
  origin: string;
  updated_at: Date;
}

interface PageTemplateRow {
  id: string;
  name: string;
  description: string | null;
  agent_rules: string | null;
  slots: string[];
  a2ui: A2UIDocument;
  origin: string;
}

const COMPOSITION_COLUMNS = `id, name, family, description, agent_rules, type, tags,
         components_used, a2ui_version, a2ui, origin, updated_at`;

const PAGE_TEMPLATE_COLUMNS = `id, name, description, agent_rules, slots, a2ui, origin`;

// A null column becomes an absent field, not an explicit undefined: the contract
// schemas use .optional(), and a record has to round-trip through them.
function toComposition(row: CompositionRow): CompositionRecord {
  return {
    compositionId: row.id,
    name: row.name,
    family: row.family ?? "",
    description: row.description ?? "",
    ...(row.agent_rules === null ? {} : { agentRules: row.agent_rules }),
    type: row.type,
    tags: row.tags,
    a2ui: row.a2ui,
    componentsUsed: row.components_used,
    a2uiVersion: row.a2ui_version,
    origin: row.origin as RecordOrigin,
    updatedAt: row.updated_at.toISOString(),
  };
}

function toPageTemplate(row: PageTemplateRow): PageTemplateRecord {
  return {
    pageTemplateId: row.id,
    name: row.name,
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.agent_rules === null ? {} : { agentRules: row.agent_rules }),
    a2ui: row.a2ui,
    slots: row.slots,
    origin: row.origin as RecordOrigin,
  };
}

export class PostgresAuthoringStore implements AuthoringStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly dsPack: string,
    // From the pack's pack.json. Authored records inherit it instead of asking.
    private readonly a2uiVersion: string,
  ) {}

  async listCompositions(): Promise<CompositionRecord[]> {
    const { rows } = await this.pool.query<CompositionRow>(
      `select ${COMPOSITION_COLUMNS} from compositions where ds_pack = $1 order by name`,
      [this.dsPack],
    );
    return rows.map(toComposition);
  }

  async upsertComposition(input: CompositionInput): Promise<CompositionRecord> {
    const { rows } = await this.pool.query<CompositionRow>(
      `insert into compositions
         (id, ds_pack, name, family, description, agent_rules, type, tags,
          components_used, a2ui_version, a2ui, origin)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, 'authored')
       on conflict (id) do update set
         ds_pack = excluded.ds_pack, name = excluded.name, family = excluded.family,
         description = excluded.description, agent_rules = excluded.agent_rules,
         type = excluded.type, tags = excluded.tags,
         components_used = excluded.components_used, a2ui_version = excluded.a2ui_version,
         a2ui = excluded.a2ui, updated_at = now()
       returning ${COMPOSITION_COLUMNS}`,
      [
        input.compositionId,
        this.dsPack,
        input.name,
        input.family,
        input.description,
        input.agentRules ?? null,
        input.type,
        input.tags,
        documentComponents(input.a2ui),
        this.a2uiVersion,
        JSON.stringify(input.a2ui),
      ],
    );
    return toComposition(rows[0]!);
  }

  async deleteComposition(compositionId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`delete from compositions where ds_pack = $1 and id = $2`, [
      this.dsPack,
      compositionId,
    ]);
    return (rowCount ?? 0) > 0;
  }

  async compositionDeleteImpact(compositionId: string): Promise<DeleteImpact | null> {
    const { rows } = await this.pool.query<{ origin: string; placements: number; saved_versions: number }>(
      `select c.origin,
              (select count(*)::int from placements p where p.composition_id = c.id) as placements,
              (select count(*)::int from composition_versions v where v.composition_id = c.id) as saved_versions
       from compositions c where c.ds_pack = $1 and c.id = $2`,
      [this.dsPack, compositionId],
    );
    const row = rows[0];
    if (!row) return null;
    return { origin: row.origin as RecordOrigin, placements: row.placements, savedVersions: row.saved_versions };
  }

  async listPageTemplates(): Promise<PageTemplateRecord[]> {
    const { rows } = await this.pool.query<PageTemplateRow>(
      `select ${PAGE_TEMPLATE_COLUMNS} from page_templates where ds_pack = $1 order by name`,
      [this.dsPack],
    );
    return rows.map(toPageTemplate);
  }

  async upsertPageTemplate(input: PageTemplateInput): Promise<PageTemplateRecord> {
    const { rows } = await this.pool.query<PageTemplateRow>(
      `insert into page_templates
         (id, ds_pack, name, description, agent_rules, slots, a2ui, origin)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, 'authored')
       on conflict (id) do update set
         ds_pack = excluded.ds_pack, name = excluded.name,
         description = excluded.description, agent_rules = excluded.agent_rules,
         slots = excluded.slots, a2ui = excluded.a2ui
       returning ${PAGE_TEMPLATE_COLUMNS}`,
      [
        input.pageTemplateId,
        this.dsPack,
        input.name,
        input.description ?? null,
        input.agentRules ?? null,
        documentSlots(input.a2ui),
        JSON.stringify(input.a2ui),
      ],
    );
    return toPageTemplate(rows[0]!);
  }

  async deletePageTemplate(pageTemplateId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`delete from page_templates where ds_pack = $1 and id = $2`, [
      this.dsPack,
      pageTemplateId,
    ]);
    return (rowCount ?? 0) > 0;
  }

  // Pages keep no version history of their own, so savedVersions is always 0.
  async pageTemplateDeleteImpact(pageTemplateId: string): Promise<DeleteImpact | null> {
    const { rows } = await this.pool.query<{ origin: string; placements: number }>(
      `select pt.origin,
              (select count(*)::int from placements p where p.page_template_id = pt.id) as placements
       from page_templates pt where pt.ds_pack = $1 and pt.id = $2`,
      [this.dsPack, pageTemplateId],
    );
    const row = rows[0];
    if (!row) return null;
    return { origin: row.origin as RecordOrigin, placements: row.placements, savedVersions: 0 };
  }

  async placementsForPage(pageTemplateId: string): Promise<PlacementRecord[]> {
    const { rows } = await this.pool.query<{
      composition_id: string;
      page_template_id: string;
      slot_id: string;
      variant: string | null;
      position: number;
    }>(
      `select p.composition_id, p.page_template_id, p.slot_id, p.variant, p.position
       from placements p
       join page_templates pt on pt.id = p.page_template_id
       where p.page_template_id = $1 and pt.ds_pack = $2
       order by p.position, p.slot_id`,
      [pageTemplateId, this.dsPack],
    );
    return rows.map((r) => ({
      compositionId: r.composition_id,
      pageTemplateId: r.page_template_id,
      slotId: r.slot_id,
      ...(r.variant === null ? {} : { variant: r.variant }),
      position: r.position,
    }));
  }

  async setPlacement(input: PlacementInput): Promise<void> {
    await this.pool.query(
      `insert into placements (composition_id, page_template_id, slot_id, variant, position)
       values ($1, $2, $3, $4, $5)
       on conflict (composition_id, page_template_id, slot_id) do update set
         variant = excluded.variant, position = excluded.position`,
      [input.compositionId, input.pageTemplateId, input.slotId, input.variant ?? null, input.position],
    );
  }

  async deletePlacement(key: PlacementKey): Promise<void> {
    await this.pool.query(
      `delete from placements
       where composition_id = $1 and page_template_id = $2 and slot_id = $3`,
      [key.compositionId, key.pageTemplateId, key.slotId],
    );
  }

  async listVersions(compositionId: string): Promise<CompositionVersionSummary[]> {
    const { rows } = await this.pool.query<{
      version: number;
      summary: string | null;
      saved_by: string | null;
      saved_at: Date;
    }>(
      `select v.version, v.summary, v.saved_by, v.saved_at
       from composition_versions v
       join compositions c on c.id = v.composition_id
       where v.composition_id = $1 and c.ds_pack = $2
       order by v.version desc`,
      [compositionId, this.dsPack],
    );
    return rows.map((r) => ({
      version: r.version,
      ...(r.summary === null ? {} : { summary: r.summary }),
      ...(r.saved_by === null ? {} : { savedBy: r.saved_by }),
      savedAt: r.saved_at.toISOString(),
    }));
  }

  // Versions number from 1 per composition. The row lock serializes concurrent
  // appends for one composition, so two callers cannot pick the same number and
  // collide on the primary key.
  async appendVersion(input: {
    compositionId: string;
    a2ui: A2UIDocument;
    summary?: string;
    savedBy: SavedBy;
  }): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const owner = await client.query(`select 1 from compositions where ds_pack = $1 and id = $2 for update`, [
        this.dsPack,
        input.compositionId,
      ]);
      if (owner.rowCount === 0) throw new Error(`No such composition "${input.compositionId}"`);

      const { rows } = await client.query<{ version: number }>(
        `insert into composition_versions (composition_id, version, a2ui, summary, saved_by)
         select $1, coalesce(max(version), 0) + 1, $2::jsonb, $3, $4
         from composition_versions where composition_id = $1
         returning version`,
        [input.compositionId, JSON.stringify(input.a2ui), input.summary ?? null, input.savedBy],
      );
      await client.query("commit");
      return rows[0]!.version;
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }
}
