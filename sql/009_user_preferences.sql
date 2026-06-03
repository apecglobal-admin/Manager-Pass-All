alter table public.app_users
  add column if not exists preferences jsonb not null default '{}'::jsonb;
