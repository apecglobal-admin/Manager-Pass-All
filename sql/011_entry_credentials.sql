create table if not exists public.entry_credentials (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  username text not null default '',
  password_cipher jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_entry_credentials_entry_id on public.entry_credentials(entry_id);
create index if not exists idx_entry_credentials_department_id on public.entry_credentials(department_id);

alter table public.entry_credentials enable row level security;

drop policy if exists "entry credentials admin access" on public.entry_credentials;
create policy "entry credentials admin access" on public.entry_credentials
  for all
  using (
    exists (
      select 1 from public.app_users
      where app_users.auth_user_id = auth.uid()
        and app_users.status = 'Active'
        and app_users.role = 'Admin'
    )
  )
  with check (
    exists (
      select 1 from public.app_users
      where app_users.auth_user_id = auth.uid()
        and app_users.status = 'Active'
        and app_users.role = 'Admin'
    )
  );
