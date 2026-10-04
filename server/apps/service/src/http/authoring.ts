// Studio write door. Every route parses its body against the contract, runs the
// same validator the agent is held to, and then calls the AuthoringStore port.
// No SQL, no agent logic and no model calls live here.
//
// Validation contract for writes: a body that is not a well-formed request at
// all is a 400 with Zod issues; a well-formed body whose A2UI document has
// blocking findings is a 422 carrying those findings, so the Studio can show
// the same codes the agent would get. Nothing that fails validation is stored.
import { Hono } from "hono";
import { z } from "zod";
import {
  CompositionInput,
  PageTemplateInput,
  PlacementInput,
  PlacementKey,
  type ValidationReport,
} from "@experience-agent/contract";
import {
  blocking,
  validate,
  warnings,
  type AuthoringStore,
  type CatalogSource,
  type DocumentKind,
} from "@experience-agent/core";

// Rows inserted by a sample re-import. Declared structurally so the HTTP door
// does not import the Postgres adapter.
export interface SampleImportCounts {
  compositions: number;
  pageTemplates: number;
  placements: number;
}

export interface AuthoringDeps {
  authoring: AuthoringStore;
  // The pack's catalog, for the validator.
  catalog: CatalogSource;
  // Drops the cached picker list after a write.
  invalidateCompositions: () => void;
  // Re-imports the pack's sample content (insert-only). Supplied by wire().
  importSamples: () => Promise<SampleImportCounts>;
}

// A save may name what changed, for the history panel. It is not part of the
// record, so it rides alongside the input rather than inside it.
const CompositionSave = CompositionInput.extend({ summary: z.string().min(1).optional() });

const ValidateBody = z.object({
  // Deliberately unknown: validate() is defensive about malformed input and
  // reports an envelope finding, which is far more useful while someone types
  // than a schema rejection.
  a2ui: z.unknown(),
  kind: z.enum(["composition", "page"]).default("composition"),
});

// Scope checks compare a draft against what the designer currently sees, which
// only applies to agent edits. Authoring has no "current", so it is omitted.
function reportFor(doc: unknown, kind: DocumentKind, catalog: CatalogSource): ValidationReport {
  const findings = validate(doc, { kind, catalog });
  return { errors: blocking(findings), warnings: warnings(findings) };
}

export function createAuthoringRoutes(deps: AuthoringDeps): Hono {
  const app = new Hono();

  // --- Compositions ---------------------------------------------------------

  app.get("/compositions", async (c) => c.json(await deps.authoring.listCompositions()));

  app.put("/compositions/:compositionId", async (c) => {
    const compositionId = c.req.param("compositionId");
    const body = CompositionSave.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "Invalid composition", issues: body.error.issues }, 400);
    if (body.data.compositionId !== compositionId) {
      return c.json({ error: `Body id "${body.data.compositionId}" does not match the path id "${compositionId}"` }, 400);
    }

    const validation = reportFor(body.data.a2ui, "composition", deps.catalog);
    if (validation.errors.length > 0) {
      return c.json({ error: "The document does not validate", ...validation }, 422);
    }

    const { summary, ...input } = body.data;
    const record = await deps.authoring.upsertComposition(input);
    // Every save is a snapshot, so the history panel shows what was saved when.
    const version = await deps.authoring.appendVersion({
      compositionId,
      a2ui: record.a2ui,
      savedBy: "studio",
      ...(summary === undefined ? {} : { summary }),
    });
    deps.invalidateCompositions();
    return c.json({ record, version, warnings: validation.warnings });
  });

  app.delete("/compositions/:compositionId", async (c) => {
    const deleted = await deps.authoring.deleteComposition(c.req.param("compositionId"));
    if (!deleted) return c.json({ error: "Composition not found" }, 404);
    deps.invalidateCompositions();
    return c.body(null, 204);
  });

  // What a hard delete would take with it, for the confirm dialog. Cascading
  // away saved versions cannot be undone, so the counts are shown before the click.
  app.get("/compositions/:compositionId/delete-impact", async (c) => {
    const impact = await deps.authoring.compositionDeleteImpact(c.req.param("compositionId"));
    if (!impact) return c.json({ error: "Composition not found" }, 404);
    return c.json(impact);
  });

  app.get("/compositions/:compositionId/versions", async (c) => {
    const compositionId = c.req.param("compositionId");
    const exists = await deps.authoring.compositionDeleteImpact(compositionId);
    if (!exists) return c.json({ error: "Composition not found" }, 404);
    return c.json(await deps.authoring.listVersions(compositionId));
  });

  // --- Page templates -------------------------------------------------------

  app.get("/page-templates", async (c) => c.json(await deps.authoring.listPageTemplates()));

  app.put("/page-templates/:pageTemplateId", async (c) => {
    const pageTemplateId = c.req.param("pageTemplateId");
    const body = PageTemplateInput.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "Invalid page template", issues: body.error.issues }, 400);
    if (body.data.pageTemplateId !== pageTemplateId) {
      return c.json({ error: `Body id "${body.data.pageTemplateId}" does not match the path id "${pageTemplateId}"` }, 400);
    }

    // "page" is the kind that lets Slot through; a composition may not contain one.
    const validation = reportFor(body.data.a2ui, "page", deps.catalog);
    if (validation.errors.length > 0) {
      return c.json({ error: "The document does not validate", ...validation }, 422);
    }

    const record = await deps.authoring.upsertPageTemplate(body.data);
    return c.json({ record, warnings: validation.warnings });
  });

  app.delete("/page-templates/:pageTemplateId", async (c) => {
    const deleted = await deps.authoring.deletePageTemplate(c.req.param("pageTemplateId"));
    if (!deleted) return c.json({ error: "Page template not found" }, 404);
    return c.body(null, 204);
  });

  app.get("/page-templates/:pageTemplateId/delete-impact", async (c) => {
    const impact = await deps.authoring.pageTemplateDeleteImpact(c.req.param("pageTemplateId"));
    if (!impact) return c.json({ error: "Page template not found" }, 404);
    return c.json(impact);
  });

  // --- Mappings -------------------------------------------------------------

  app.get("/page-templates/:pageTemplateId/placements", async (c) =>
    c.json(await deps.authoring.placementsForPage(c.req.param("pageTemplateId"))),
  );

  app.put("/placements", async (c) => {
    const body = PlacementInput.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "Invalid placement", issues: body.error.issues }, 400);
    const input = body.data;

    // A placement is only meaningful in a slot the page actually declares, and
    // a page's slots are derived from its Slot nodes, so this is checkable.
    const page = (await deps.authoring.listPageTemplates()).find((p) => p.pageTemplateId === input.pageTemplateId);
    if (!page) return c.json({ error: `Unknown page template "${input.pageTemplateId}"` }, 404);
    if (!page.slots.includes(input.slotId)) {
      return c.json({ error: `Page "${page.pageTemplateId}" has no slot "${input.slotId}"`, slots: page.slots }, 400);
    }

    const compositions = await deps.authoring.listCompositions();
    if (!compositions.some((x) => x.compositionId === input.compositionId)) {
      return c.json({ error: `Unknown composition "${input.compositionId}"` }, 404);
    }

    await deps.authoring.setPlacement(input);
    return c.json(await deps.authoring.placementsForPage(input.pageTemplateId));
  });

  app.delete("/placements", async (c) => {
    const body = PlacementKey.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "Invalid placement key", issues: body.error.issues }, 400);
    await deps.authoring.deletePlacement(body.data);
    return c.body(null, 204);
  });

  // --- Validation and samples ----------------------------------------------

  // Always 200: this is a report, not a verdict on the request. The Studio calls
  // it while someone types.
  app.post("/validate", async (c) => {
    const body = ValidateBody.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "Invalid request", issues: body.error.issues }, 400);
    return c.json(reportFor(body.data.a2ui, body.data.kind, deps.catalog));
  });

  // Insert-only, so this can never clobber authored work. It brings back sample
  // rows that were deleted and adds any the database never had.
  app.post("/samples/import", async (c) => {
    const counts = await deps.importSamples();
    deps.invalidateCompositions();
    return c.json(counts);
  });

  return app;
}
