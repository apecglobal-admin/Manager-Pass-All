create or replace function public.current_app_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_users
    where app_users.auth_user_id = auth.uid()
      and app_users.status = 'Active'
      and (
        app_users.role = 'Admin'
        or 'users.manage' = any(app_users.permissions)
      )
  );
$$;

grant execute on function public.current_app_user_is_admin() to authenticated;

drop policy if exists "app users admin access" on public.app_users;
create policy "app users admin access" on public.app_users
  for all
  to authenticated
  using (public.current_app_user_is_admin())
  with check (public.current_app_user_is_admin());

drop policy if exists "vaults admin access" on public.vaults;
create policy "vaults admin access" on public.vaults
  for all
  to authenticated
  using (public.current_app_user_is_admin())
  with check (public.current_app_user_is_admin());

drop policy if exists "projects admin access" on public.projects;
create policy "projects admin access" on public.projects
  for all
  to authenticated
  using (public.current_app_user_is_admin())
  with check (public.current_app_user_is_admin());

drop policy if exists "entries admin access" on public.entries;
create policy "entries admin access" on public.entries
  for all
  to authenticated
  using (public.current_app_user_is_admin())
  with check (public.current_app_user_is_admin());

drop policy if exists "project memberships admin access" on public.project_memberships;
create policy "project memberships admin access" on public.project_memberships
  for all
  to authenticated
  using (public.current_app_user_is_admin())
  with check (public.current_app_user_is_admin());

drop policy if exists "detailed permissions admin access" on public.detailed_permissions;
create policy "detailed permissions admin access" on public.detailed_permissions
  for all
  to authenticated
  using (public.current_app_user_is_admin())
  with check (public.current_app_user_is_admin());

drop policy if exists "entry types admin access" on public.entry_types;
create policy "entry types admin access" on public.entry_types
  for all
  to authenticated
  using (public.current_app_user_is_admin())
  with check (public.current_app_user_is_admin());

drop policy if exists "departments admin access" on public.departments;
create policy "departments admin access" on public.departments
  for all
  to authenticated
  using (public.current_app_user_is_admin())
  with check (public.current_app_user_is_admin());

drop policy if exists "app settings admin access" on public.app_settings;
create policy "app settings admin access" on public.app_settings
  for all
  to authenticated
  using (public.current_app_user_is_admin())
  with check (public.current_app_user_is_admin());

drop policy if exists "activity logs admin access" on public.activity_logs;
create policy "activity logs admin access" on public.activity_logs
  for all
  to authenticated
  using (public.current_app_user_is_admin())
  with check (public.current_app_user_is_admin());
