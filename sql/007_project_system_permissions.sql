create table if not exists public.project_systems (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  type text not null default 'Web',
  description text not null default '',
  status text not null default 'Active',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_project_systems_project_id on public.project_systems(project_id);
create index if not exists idx_project_systems_project_sort_order on public.project_systems(project_id, sort_order, name);

alter table public.entries
  add column if not exists system_id uuid references public.project_systems(id) on delete set null;

create index if not exists idx_entries_system_id on public.entries(system_id);

alter table public.detailed_permissions
  add column if not exists system_id uuid references public.project_systems(id) on delete cascade;

alter table public.detailed_permissions
  alter column entry_type_id drop not null;

create index if not exists idx_detailed_permissions_system_id on public.detailed_permissions(system_id);

drop index if exists public.detailed_permissions_user_project_entry_type_idx;
create unique index if not exists detailed_permissions_user_project_entry_type_idx
  on public.detailed_permissions(user_id, project_id, entry_type_id)
  where system_id is null and entry_type_id is not null;

create unique index if not exists detailed_permissions_user_project_system_idx
  on public.detailed_permissions(user_id, project_id, system_id)
  where system_id is not null;

alter table public.project_systems enable row level security;

drop policy if exists "project systems authenticated read" on public.project_systems;
create policy "project systems authenticated read" on public.project_systems
  for select to authenticated
  using (true);

drop policy if exists "project systems admin access" on public.project_systems;
create policy "project systems admin access" on public.project_systems
  for all to authenticated
  using (
    exists (
      select 1 from public.app_users
      where app_users.auth_user_id = auth.uid()
        and (app_users.role = 'Admin' or 'users.manage' = any(app_users.permissions))
    )
  )
  with check (
    exists (
      select 1 from public.app_users
      where app_users.auth_user_id = auth.uid()
        and (app_users.role = 'Admin' or 'users.manage' = any(app_users.permissions))
    )
  );
