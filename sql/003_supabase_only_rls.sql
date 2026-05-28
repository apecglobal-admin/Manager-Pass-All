create index if not exists idx_profiles_email on public.profiles(lower(email));
create index if not exists idx_vaults_owner_id on public.vaults(owner_id);
create index if not exists idx_projects_vault_id on public.projects(vault_id);
create index if not exists idx_entries_vault_id on public.entries(vault_id);
create index if not exists idx_entries_project_id on public.entries(project_id);
create index if not exists idx_entries_entry_type_id on public.entries(entry_type_id);
create index if not exists idx_app_users_auth_user_id on public.app_users(auth_user_id);
create index if not exists idx_app_users_username on public.app_users(lower(username));
create index if not exists idx_project_memberships_project_id on public.project_memberships(project_id);
create index if not exists idx_detailed_permissions_project_id on public.detailed_permissions(project_id);
create index if not exists idx_activity_logs_vault_id on public.activity_logs(vault_id);

alter table public.profiles enable row level security;
alter table public.vaults enable row level security;
alter table public.projects enable row level security;
alter table public.entries enable row level security;
alter table public.activity_logs enable row level security;
alter table public.app_users enable row level security;
alter table public.entry_types enable row level security;
alter table public.app_settings enable row level security;
alter table public.project_memberships enable row level security;
alter table public.detailed_permissions enable row level security;

drop policy if exists "profiles owner access" on public.profiles;
create policy "profiles owner access" on public.profiles
  for all using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "vaults owner access" on public.vaults;
create policy "vaults owner access" on public.vaults
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "projects owner or member access" on public.projects;
create policy "projects owner or member access" on public.projects
  for all using (
    exists (
      select 1 from public.vaults
      where public.vaults.id = public.projects.vault_id
      and public.vaults.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.app_users
      join public.project_memberships on project_memberships.user_id = app_users.id
      where app_users.auth_user_id = auth.uid()
      and project_memberships.project_id = public.projects.id
    )
  )
  with check (
    exists (
      select 1 from public.vaults
      where public.vaults.id = public.projects.vault_id
      and public.vaults.owner_id = auth.uid()
    )
  );

drop policy if exists "entries owner or member access" on public.entries;
create policy "entries owner or member access" on public.entries
  for all using (
    exists (
      select 1 from public.vaults
      where public.vaults.id = public.entries.vault_id
      and public.vaults.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.app_users
      join public.project_memberships on project_memberships.user_id = app_users.id
      where app_users.auth_user_id = auth.uid()
      and project_memberships.project_id = public.entries.project_id
    )
  )
  with check (
    exists (
      select 1 from public.vaults
      where public.vaults.id = public.entries.vault_id
      and public.vaults.owner_id = auth.uid()
    )
  );

drop policy if exists "app users self read" on public.app_users;
create policy "app users self read" on public.app_users
  for select using (auth_user_id = auth.uid());

drop policy if exists "entry types authenticated read" on public.entry_types;
create policy "entry types authenticated read" on public.entry_types
  for select using (auth.role() = 'authenticated');

drop policy if exists "app settings authenticated read" on public.app_settings;
create policy "app settings authenticated read" on public.app_settings
  for select using (auth.role() = 'authenticated');

drop policy if exists "project memberships self read" on public.project_memberships;
create policy "project memberships self read" on public.project_memberships
  for select using (
    exists (
      select 1 from public.app_users
      where app_users.id = project_memberships.user_id
      and app_users.auth_user_id = auth.uid()
    )
  );

drop policy if exists "detailed permissions self read" on public.detailed_permissions;
create policy "detailed permissions self read" on public.detailed_permissions
  for select using (
    exists (
      select 1 from public.app_users
      where app_users.id = detailed_permissions.user_id
      and app_users.auth_user_id = auth.uid()
    )
  );

drop policy if exists "activity logs owner or member access" on public.activity_logs;
create policy "activity logs owner or member access" on public.activity_logs
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
