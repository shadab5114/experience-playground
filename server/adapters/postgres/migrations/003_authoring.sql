-- Authoring (Studio) support. Two kinds of change, both in service of letting
-- people create and edit content in the UI instead of editing seed files.
--
-- 1. Authored prose per record. `description` helps the agent pick a
--    composition; `agent_rules` steers how it edits one. `origin` separates
--    content imported from a pack's sample files from content a person wrote,
--    so the UI can label it and offer a re-import.
-- 2. Cascading deletes. Deleting a composition or a page in the UI must not be
--    blocked by the placements that reference it, or by its own history.

-- `origin` lands as 'sample' for rows that already exist and 'authored' for rows
-- inserted from here on. Before this migration the only thing that could write
-- content was the pack importer, so every existing row is a sample by definition.
alter table compositions
  add column agent_rules text,
  add column origin      text not null default 'sample';
alter table compositions alter column origin set default 'authored';

alter table page_templates
  add column description text,
  add column agent_rules text,
  add column origin      text not null default 'sample';
alter table page_templates alter column origin set default 'authored';

alter table placements
  drop constraint placements_composition_id_fkey,
  add  constraint placements_composition_id_fkey
       foreign key (composition_id) references compositions(id) on delete cascade;

alter table placements
  drop constraint placements_page_template_id_fkey,
  add  constraint placements_page_template_id_fkey
       foreign key (page_template_id) references page_templates(id) on delete cascade;

alter table composition_versions
  drop constraint composition_versions_composition_id_fkey,
  add  constraint composition_versions_composition_id_fkey
       foreign key (composition_id) references compositions(id) on delete cascade;
