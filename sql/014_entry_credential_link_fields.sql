create table if not exists public.entry_credentials (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null,
  department_id uuid,
  username text not null default '',
  password_cipher jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.entry_credentials
  add column if not exists link_type text not null default 'Account';

alter table public.entry_credentials
  add column if not exists url text not null default '';

do $$
begin
  if to_regclass('public.entries') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'entry_credentials_entry_id_fkey'
        and conrelid = 'public.entry_credentials'::regclass
    )
  then
    alter table public.entry_credentials
      add constraint entry_credentials_entry_id_fkey
      foreign key (entry_id) references public.entries(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if to_regclass('public.departments') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'entry_credentials_department_id_fkey'
        and conrelid = 'public.entry_credentials'::regclass
    )
  then
    alter table public.entry_credentials
      add constraint entry_credentials_department_id_fkey
      foreign key (department_id) references public.departments(id) on delete set null;
  end if;
end $$;

create index if not exists idx_entry_credentials_entry_id on public.entry_credentials(entry_id);
create index if not exists idx_entry_credentials_department_id on public.entry_credentials(department_id);

alter table public.entry_credentials enable row level security;

do $$
begin
  if to_regclass('public.app_users') is not null then
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
  end if;
end $$;
