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
  kdf_salt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults(id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid not null references public.vaults(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  name text not null,
  type text not null default 'Other',
  environment text not null default 'Production',
  url text not null default '',
  username text not null default '',
  password_cipher jsonb not null,
  secret_notes_cipher jsonb,
  tags text[] not null default '{}',
  status text not null default 'Active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null,
  last_seen_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  vault_id uuid references public.vaults(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  entry_id uuid references public.entries(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_vaults_owner_id on public.vaults(owner_id);
create index if not exists idx_projects_vault_id on public.projects(vault_id);
create index if not exists idx_entries_vault_id on public.entries(vault_id);
create index if not exists idx_entries_project_id on public.entries(project_id);
create index if not exists idx_devices_user_id on public.devices(user_id);
create index if not exists idx_activity_logs_vault_id on public.activity_logs(vault_id);

alter table public.profiles enable row level security;
alter table public.vaults enable row level security;
alter table public.projects enable row level security;
alter table public.entries enable row level security;
alter table public.devices enable row level security;
alter table public.activity_logs enable row level security;

create policy "profiles owner access" on public.profiles
  for all using (id = auth.uid())
  with check (id = auth.uid());

create policy "vaults owner access" on public.vaults
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "projects vault owner access" on public.projects
  for all using (
    exists (
      select 1 from public.vaults
      where public.vaults.id = public.projects.vault_id
      and public.vaults.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.vaults
      where public.vaults.id = public.projects.vault_id
      and public.vaults.owner_id = auth.uid()
    )
  );

create policy "entries vault owner access" on public.entries
  for all using (
    exists (
      select 1 from public.vaults
      where public.vaults.id = public.entries.vault_id
      and public.vaults.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.vaults
      where public.vaults.id = public.entries.vault_id
      and public.vaults.owner_id = auth.uid()
    )
  );

create policy "devices owner access" on public.devices
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "activity logs vault owner access" on public.activity_logs
  for all using (
    user_id = auth.uid()
    or exists (
      select 1 from public.vaults
      where public.vaults.id = public.activity_logs.vault_id
      and public.vaults.owner_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.vaults
      where public.vaults.id = public.activity_logs.vault_id
      and public.vaults.owner_id = auth.uid()
    )
  );
