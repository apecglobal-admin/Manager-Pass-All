create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_users
  add column if not exists department_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_users_department_id_fkey'
  ) then
    alter table public.app_users
      add constraint app_users_department_id_fkey
      foreign key (department_id) references public.departments(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_app_users_department_id on public.app_users(department_id);
create index if not exists idx_departments_sort_order on public.departments(sort_order);

alter table public.departments enable row level security;

drop policy if exists "departments admin access" on public.departments;
create policy "departments admin access" on public.departments
  for all
  to authenticated
  using (public.current_app_user_is_admin())
  with check (public.current_app_user_is_admin());
