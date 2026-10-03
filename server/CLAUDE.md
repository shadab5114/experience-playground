# Experience Agent (backend)

A TypeScript service (runs on Node LTS; avoids Bun-only APIs) that runs a fixed LangGraph flow to edit A2UI compositions
grounded in a design system. Two front doors share one core: HTTP + SSE for
the Experience Playground, and A2A for other agents. One Postgres database
holds compositions, mappings and thread memory. Full plan: ../docs/BACKEND_PLAN.md.
Read it before any task.

## Rules
- Full control: every step is an explicit LangGraph node. Never let the model
  choose which nodes run.
- packages/core must not import adapters, design system packs, vendor SDKs or
  database code. It talks only to the ports in core/src/ports.ts.
- Both doors call runAgent(). No agent logic in http/ or a2a/.
- Everything design-system specific lives in ds-packs/<name>, including seed data.
- All SQL lives in adapters/postgres. Change the schema only by adding a new
  numbered migration file; never edit an applied one.
- The contract package is the spec. Never change it without saying so; the
  playground imports the same package.
- Nothing reaches a caller without passing validate(). No exceptions.
- The validator engine is plain code with no model calls.
- Template and placement reads never call the model.
- Config comes from env (DATABASE_URL, ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY,
  MODEL_ID, DS_PACK, ...). Never hardcode URLs or keys, and never log keys.
- The caller's currentA2ui is the source of truth. Store only short summaries
  in thread messages, never whole A2UI documents.
- Reuse the existing catalog compiler, validator and Postgres checkpointer
  setup where they exist; ask before rewriting them.
- Keep it simple: no queues, extra services or dependencies beyond the plan's
  stack table without asking.
- One building block at a time. Finish with its acceptance criteria checked
  and tests passing, then stop and summarize.
