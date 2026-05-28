create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.vaults (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kdf_salt text not null default encode(gen_random_bytes(16), 'base64'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid references public.vaults(id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid references public.vaults(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  entry_type_id uuid,
  name text not null,
  type text not null default 'Other',
  environment text not null default 'Production',
  url text not null default '',
  username text not null default '',
  password_cipher jsonb not null default '{}'::jsonb,
  secret_notes_cipher jsonb,
  tags text[] not null default '{}',
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.entries
  add column if not exists entry_type_id uuid;

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid references public.vaults(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  entry_id uuid references public.entries(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete set null,
  username text not null unique,
  display_name text not null default '',
  role text not null default 'Viewer',
  status text not null default 'Pending',
  permissions text[] not null default '{}',
  invitation_sent_at timestamptz,
  invite_expires_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.entry_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'entries_entry_type_id_fkey'
  ) then
    alter table public.entries
      add constraint entries_entry_type_id_fkey
      foreign key (entry_type_id) references public.entry_types(id)
      on delete set null;
  end if;
end $$;

insert into public.entry_types (name, slug, sort_order)
values
  ('Web', 'web', 1),
  ('Admin', 'admin', 2),
  ('Mobile', 'mobile', 3),
  ('Desktop', 'desktop', 4),
  ('API', 'api', 5),
  ('Hosting', 'hosting', 6),
  ('Domain', 'domain', 7),
  ('Database', 'database', 8),
  ('Server', 'server', 9),
  ('Other', 'other', 10)
on conflict (name) do nothing;

insert into public.app_settings (key, value)
values ('autoLockMinutes', '15'::jsonb)
on conflict (key) do nothing;
