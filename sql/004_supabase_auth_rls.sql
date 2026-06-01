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

create or replace function public.has_no_app_users()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.app_users);
$$;

grant execute on function public.current_app_user_is_admin() to authenticated;
grant execute on function public.has_no_app_users() to authenticated;

drop policy if exists "app users self read" on public.app_users;
create policy "app users self read" on public.app_users
  for select
  to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists "app users admin access" on public.app_users;
create policy "app users admin access" on public.app_users
  for all
  to authenticated
  using (public.current_app_user_is_admin())
  with check (public.current_app_user_is_admin());

drop policy if exists "app users self access request insert" on public.app_users;
create policy "app users self access request insert" on public.app_users
  for insert
  to authenticated
  with check (
    auth_user_id = auth.uid()
    and lower(username) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and (
      (
        public.has_no_app_users()
        and role = 'Admin'
        and status = 'Active'
      )
      or (
        not public.has_no_app_users()
        and role = 'Viewer'
        and status = 'Pending'
      )
    )
  );

drop policy if exists "entry types admin write" on public.entry_types;
create policy "entry types admin write" on public.entry_types
  for all
  to authenticated
  using (public.current_app_user_is_admin())
  with check (public.current_app_user_is_admin());

drop policy if exists "app settings admin write" on public.app_settings;
create policy "app settings admin write" on public.app_settings
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

drop policy if exists "activity logs authenticated insert" on public.activity_logs;
create policy "activity logs authenticated insert" on public.activity_logs
  for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists "activity logs admin read" on public.activity_logs;
create policy "activity logs admin read" on public.activity_logs
  for select
  to authenticated
  using (public.current_app_user_is_admin());
