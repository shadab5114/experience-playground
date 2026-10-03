-- Initial schema. Applied migrations are never edited; add 002_*.sql for changes.

create table compositions (
  id               text primary key,
  ds_pack          text not null,
  name             text not null,
  type             text not null,
  tags             text[] not null default '{}',
  components_used  text[] not null default '{}',
  a2ui_version     text not null,
  a2ui             jsonb not null,
  updated_at       timestamptz not null default now()
);

create table composition_versions (
  composition_id  text not null references compositions(id),
  version         int  not null,
  a2ui            jsonb not null,
  summary         text,
  saved_by        text,
  saved_at        timestamptz not null default now(),
  primary key (composition_id, version)
);

create table flows (
  id       text primary key,
  ds_pack  text not null,
  name     text not null
);

create table page_templates (
  id       text primary key,
  flow_id  text not null references flows(id),
  ds_pack  text not null,
  name     text not null,
  slots    text[] not null,
  a2ui     jsonb not null
);

create table placements (
  composition_id    text not null references compositions(id),
  page_template_id  text not null references page_templates(id),
  slot_id           text not null,
  variant           text,
  position          int  not null default 0,
  primary key (composition_id, page_template_id, slot_id)
);

create index compositions_ds_pack_type_idx on compositions (ds_pack, type);
create index compositions_tags_idx on compositions using gin (tags);
create index compositions_components_used_idx on compositions using gin (components_used);
create index placements_page_template_id_idx on placements (page_template_id);
