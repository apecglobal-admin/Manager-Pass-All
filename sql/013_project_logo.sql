-- Migration to add logo_url to public.projects
alter table public.projects add column if not exists logo_url text;
