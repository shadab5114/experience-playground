-- Runs once, on first container start. Tests use their own database so they
-- can reset it without touching local development data.
create database experience_agent_test;
