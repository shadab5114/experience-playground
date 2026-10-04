// CompositionStore over Postgres. All SQL for reads lives here.
import type pg from "pg";
import type { CompositionCandidate, CompositionStore } from "@experience-agent/core";
import type { CompositionDetail, CompositionSummary, PlacementView, A2UIDocument } from "@experience-agent/contract";

// Escape LIKE wildcards so a search for "50%" matches literally.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Words that carry a letter or digit. Punctuation such as "-" or "–" is ignored.
const words = (text: string): string[] =>
  text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).slice(0, 8);

export class PostgresCompositionStore implements CompositionStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly dsPack: string,
  ) {}

  async list(filter: { type?: string; q?: string } = {}): Promise<CompositionSummary[]> {
    const q = filter.q ? `%${escapeLike(filter.q)}%` : null;
    const { rows } = await this.pool.query<{ id: string; name: string; type: string; tags: string[] }>(
      `select id, name, type, tags from compositions
       where ds_pack = $1
         and ($2::text is null or type = $2)
         and ($3::text is null or name ilike $3)
       order by name`,
      [this.dsPack, filter.type ?? null, q],
    );
    return rows.map((r) => ({ compositionId: r.id, name: r.name, type: r.type, tags: r.tags }));
  }

  // Family and name first, because they name the composition. Descriptions are only
  // searched when that finds nothing, since a description often mentions other tiles.
  async search(text: string): Promise<CompositionCandidate[]> {
    const terms = words(text);
    if (terms.length === 0) return [];
    const byNameOrFamily = await this.searchFields(terms, "family || ' ' || name");
    if (byNameOrFamily.length > 0) return byNameOrFamily;
    return this.searchFields(terms, "family || ' ' || name || ' ' || coalesce(description, '')");
  }

  private async searchFields(terms: string[], fields: string): Promise<CompositionCandidate[]> {
    const clauses = terms.map((_, i) => `(${fields}) ilike $${i + 2}`).join(" and ");
    const { rows } = await this.pool.query<{
      id: string;
      name: string;
      family: string | null;
      description: string | null;
      type: string;
    }>(
      `select id, name, family, description, type from compositions
       where ds_pack = $1 and ${clauses}
       order by name`,
      [this.dsPack, ...terms.map((t) => `%${escapeLike(t)}%`)],
    );
    return rows.map((r) => ({
      compositionId: r.id,
      name: r.name,
      family: r.family ?? "",
      description: r.description ?? "",
      type: r.type,
    }));
  }

  async get(compositionId: string): Promise<CompositionDetail | null> {
    const { rows } = await this.pool.query<{
      id: string;
      name: string;
      type: string;
      tags: string[];
      a2ui: A2UIDocument;
    }>(
      `select id, name, type, tags, a2ui from compositions where ds_pack = $1 and id = $2`,
      [this.dsPack, compositionId],
    );
    const row = rows[0];
    if (!row) return null;
    return { compositionId: row.id, name: row.name, type: row.type, tags: row.tags, a2ui: row.a2ui };
  }

  async placements(compositionId: string): Promise<PlacementView[]> {
    const { rows } = await this.pool.query<{
      flow_id: string;
      flow_name: string;
      page_template_id: string;
      page_name: string;
      slot_id: string;
      variant: string | null;
      page_a2ui: A2UIDocument;
    }>(
      `select f.id as flow_id, f.name as flow_name, pt.id as page_template_id, pt.name as page_name,
              p.slot_id, p.variant, pt.a2ui as page_a2ui
       from placements p
       join page_templates pt on pt.id = p.page_template_id
       join flows f on f.id = pt.flow_id
       where p.composition_id = $1 and pt.ds_pack = $2
       order by p.position`,
      [compositionId, this.dsPack],
    );
    return rows.map((r) => ({
      flowId: r.flow_id,
      flowName: r.flow_name,
      pageTemplateId: r.page_template_id,
      pageName: r.page_name,
      slotId: r.slot_id,
      ...(r.variant ? { variant: r.variant } : {}),
      pageA2ui: r.page_a2ui,
    }));
  }
}

export async function pingDatabase(pool: pg.Pool): Promise<void> {
  await pool.query("select 1");
}
