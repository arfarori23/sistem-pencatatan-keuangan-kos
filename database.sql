create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null unique,
  monthly_price numeric(14, 2) not null check (monthly_price >= 0),
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  room_id uuid references public.rooms(id) on delete set null,
  start_date date not null default current_date,
  end_date date,
  created_at timestamptz not null default now(),
  constraint tenants_dates_valid check (end_date is null or end_date >= start_date)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users(id) on delete cascade,
  name text not null unique,
  type text not null check (type in ('income', 'expense')),
  color text not null default '#aacd47' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null check (type in ('income', 'expense')),
  category_id uuid references public.categories(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  amount numeric(14, 2) not null check (amount > 0),
  transaction_date date not null default current_date,
  description text not null,
  created_at timestamptz not null default now()
);

alter table public.rooms add column if not exists owner_id uuid default auth.uid() references auth.users(id) on delete cascade;
alter table public.tenants add column if not exists owner_id uuid default auth.uid() references auth.users(id) on delete cascade;
alter table public.categories add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.transactions add column if not exists owner_id uuid default auth.uid() references auth.users(id) on delete cascade;
alter table public.categories alter column owner_id set default auth.uid();
alter table public.transactions add column if not exists room_id uuid references public.rooms(id) on delete set null;

create index if not exists tenants_room_id_idx on public.tenants(room_id);
create index if not exists transactions_date_idx on public.transactions(transaction_date desc);
create index if not exists transactions_category_id_idx on public.transactions(category_id);
create index if not exists transactions_room_id_idx on public.transactions(room_id);
create index if not exists transactions_tenant_id_idx on public.transactions(tenant_id);
create index if not exists rooms_owner_id_idx on public.rooms(owner_id);
create index if not exists tenants_owner_id_idx on public.tenants(owner_id);
create index if not exists categories_owner_id_idx on public.categories(owner_id);
create index if not exists transactions_owner_id_idx on public.transactions(owner_id);

create or replace function public.validate_tenant_room_owner()
returns trigger
language plpgsql
as $$
begin
  if new.room_id is not null and not exists (
    select 1 from public.rooms r where r.id = new.room_id and r.owner_id = auth.uid()
  ) then
    raise exception 'Kamar tidak ditemukan atau bukan milik akun ini.';
  end if;
  return new;
end;
$$;

create or replace function public.validate_transaction_category_type()
returns trigger
language plpgsql
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.categories c
    where c.id = new.category_id and c.type = new.type and (c.owner_id is null or c.owner_id = auth.uid())
  ) then
    raise exception 'Kategori tidak ditemukan, bukan milik akun ini, atau jenis arusnya tidak sesuai.';
  end if;
  if new.tenant_id is not null and not exists (
    select 1 from public.tenants t where t.id = new.tenant_id and t.owner_id = auth.uid()
  ) then
    raise exception 'Penghuni tidak ditemukan atau bukan milik akun ini.';
  end if;
  if new.room_id is not null and not exists (
    select 1 from public.rooms r where r.id = new.room_id and r.owner_id = auth.uid()
  ) then
    raise exception 'Kamar tidak ditemukan atau bukan milik akun ini.';
  end if;
  if new.room_id is not null and new.tenant_id is not null and not exists (
    select 1 from public.tenants t where t.id = new.tenant_id and t.room_id = new.room_id
  ) then
    raise exception 'Penghuni yang dipilih tidak menempati kamar tersebut.';
  end if;
  return new;
end;
$$;

create or replace function public.validate_category_type_change()
returns trigger
language plpgsql
as $$
begin
  if new.type is distinct from old.type and exists (
    select 1 from public.transactions t where t.category_id = new.id and t.type <> new.type
  ) then
    raise exception 'Jenis kategori tidak dapat diubah selama masih digunakan oleh transaksi dengan jenis arus berbeda.';
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_category_type_check on public.transactions;
create trigger transactions_category_type_check
before insert or update of category_id, room_id, tenant_id, type on public.transactions
for each row execute function public.validate_transaction_category_type();

drop trigger if exists tenants_room_owner_check on public.tenants;
create trigger tenants_room_owner_check
before insert or update of room_id on public.tenants
for each row execute function public.validate_tenant_room_owner();

drop trigger if exists categories_type_change_check on public.categories;
create trigger categories_type_change_check
before update of type on public.categories
for each row execute function public.validate_category_type_change();

alter table public.rooms enable row level security;
alter table public.tenants enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;

drop policy if exists rooms_owner_access on public.rooms;
create policy rooms_owner_access on public.rooms for all to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists tenants_owner_access on public.tenants;
create policy tenants_owner_access on public.tenants for all to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists categories_visible_to_owner on public.categories;
create policy categories_visible_to_owner on public.categories for select to authenticated
using (owner_id is null or owner_id = auth.uid());

drop policy if exists categories_owner_access on public.categories;
create policy categories_owner_access on public.categories for all to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists transactions_owner_access on public.transactions;
create policy transactions_owner_access on public.transactions for all to authenticated
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

insert into public.categories (name, type, color) values
  ('Sewa kamar', 'income', '#aacd47'),
  ('Listrik', 'expense', '#e57b64'),
  ('Air', 'expense', '#6b9ea0'),
  ('Kebersihan', 'expense', '#7c9b73'),
  ('Keamanan', 'expense', '#8ca7b5'),
  ('Perbaikan', 'expense', '#d8aa53'),
  ('Lain-lain', 'expense', '#a28baf')
on conflict (name) do nothing;
