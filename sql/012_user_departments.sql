create table if not exists public.user_departments (
  user_id uuid not null references public.app_users(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, department_id)
);

insert into public.user_departments (user_id, department_id)
select id, department_id
from public.app_users
where department_id is not null
on conflict (user_id, department_id) do nothing;

create index if not exists idx_user_departments_department_id on public.user_departments(department_id);

alter table public.user_departments enable row level security;

drop policy if exists "user departments admin access" on public.user_departments;
create policy "user departments admin access" on public.user_departments
  for all
  using (
    exists (
      select 1 from public.app_users
      where app_users.auth_user_id = auth.uid()
        and app_users.status = 'Active'
        and (
          app_users.role = 'Admin'
          or 'users.manage' = any(app_users.permissions)
        )
    )
  )
  with check (
    exists (
      select 1 from public.app_users
      where app_users.auth_user_id = auth.uid()
        and app_users.status = 'Active'
        and (
          app_users.role = 'Admin'
          or 'users.manage' = any(app_users.permissions)
        )
    )
  );
