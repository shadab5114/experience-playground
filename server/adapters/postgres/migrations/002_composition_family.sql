-- A family groups the variants of one composition (for example "Basic Plan Tile"
-- groups "Basic Plan Tile - Mobile" and "Basic Plan Tile - Home"). The description
-- is written by people and lets the agent pick the closest match.
alter table compositions
  add column family      text,
  add column description text;

create index compositions_family_idx on compositions (ds_pack, family);
