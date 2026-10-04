-- Flows are gone. They grouped page templates and did one job: naming the tabs
-- in the Impacts view. Nothing in the agent ever read them, and a flow with
-- several pages broke those tabs (they were keyed by flow, so only the first
-- page in a flow was reachable). The model is now Page -> Compositions, with
-- placements as the only mapping, and Impacts tabs are per page.
--
-- Dropping the column takes its foreign key with it, so the table can go after.
alter table page_templates drop column flow_id;

drop table flows;
