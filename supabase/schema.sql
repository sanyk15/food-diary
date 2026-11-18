-- Дневник питания — схема БД (Supabase / Postgres)
-- Выполнить целиком в SQL Editor в том же проекте, что rhythm или expense-tracker.
-- Все таблицы с префиксом food_ — не пересекаются с другими приложениями.
-- Файл идемпотентен: можно запускать повторно.
--
-- Модель:
--   food_products — справочник продуктов и блюд (КБЖУ на 100 г)
--   food_entries  — записи дневника: что съедено, в какой день и приём пищи
--   food_settings — цели по КБЖУ и настройки
--
-- Все таблицы закрыты RLS: user_id = auth.uid().

create extension if not exists "pgcrypto";

-- ── Справочник продуктов ───────────────────────────────────────
-- Значения — на 100 г. basis: ready (готовый продукт, по умолчанию),
-- dry (сухой вес), raw (сырой вес).
create table if not exists public.food_products (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  aliases     text[] not null default '{}',
  category    text not null default 'other',
  kcal        numeric(7, 1) not null default 0,
  protein     numeric(6, 1) not null default 0,
  fat         numeric(6, 1) not null default 0,
  carbs       numeric(6, 1) not null default 0,
  piece_grams numeric(7, 1),
  basis       text not null default 'ready' check (basis in ('ready', 'dry', 'raw')),
  source      text not null default 'seed' check (source in ('seed', 'llm', 'manual')),
  created_at  timestamptz not null default now()
);

-- Один и тот же продукт не дублируется в справочнике пользователя.
create unique index if not exists food_products_user_name_key
  on public.food_products (user_id, lower(name));

-- ── Записи дневника ────────────────────────────────────────────
-- Значения КБЖУ фиксируются в момент записи (снимок), а не считаются
-- из справочника: правка продукта не переписывает историю.
create table if not exists public.food_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date        date not null,
  meal        text not null default 'other'
              check (meal in ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
  name        text not null,
  grams       numeric(7, 1) not null check (grams > 0),
  kcal        numeric(7, 1) not null default 0,
  protein     numeric(6, 1) not null default 0,
  fat         numeric(6, 1) not null default 0,
  carbs       numeric(6, 1) not null default 0,
  product_id  uuid,
  source      text not null default 'manual' check (source in ('product', 'llm', 'manual')),
  assumption  text,
  created_at  timestamptz not null default now()
);

-- ── Настройки ──────────────────────────────────────────────────
-- Одна строка на пользователя. Ключ OpenRouter здесь НЕ хранится —
-- он лежит только в localStorage устройства.
create table if not exists public.food_settings (
  user_id        uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  target_kcal    integer not null default 2200,
  target_protein integer not null default 140,
  target_fat     integer not null default 70,
  target_carbs   integer not null default 250,
  llm_model      text,
  advice_tips    jsonb,
  advice_updated_at timestamptz,
  updated_at     timestamptz not null default now()
);

-- Для баз, созданных до появления советов ИИ.
alter table public.food_settings add column if not exists advice_tips jsonb;
alter table public.food_settings add column if not exists advice_updated_at timestamptz;

-- ── Индексы ────────────────────────────────────────────────────
create index if not exists food_products_user_idx on public.food_products (user_id, category);
create index if not exists food_entries_user_date_idx on public.food_entries (user_id, date desc, created_at);
create index if not exists food_entries_product_idx on public.food_entries (product_id);

-- ── Row Level Security ─────────────────────────────────────────
alter table public.food_products enable row level security;
alter table public.food_entries  enable row level security;
alter table public.food_settings enable row level security;

drop policy if exists "food_products_own" on public.food_products;
create policy "food_products_own" on public.food_products
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "food_entries_own" on public.food_entries;
create policy "food_entries_own" on public.food_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "food_settings_own" on public.food_settings;
create policy "food_settings_own" on public.food_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Целостность: запись ссылается только на свой продукт ───────
alter table public.food_products drop constraint if exists food_products_id_user_key;
alter table public.food_products add constraint food_products_id_user_key unique (id, user_id);

-- При удалении продукта обнуляется только product_id (user_id NOT NULL).
alter table public.food_entries drop constraint if exists food_entries_product_id_fkey;
alter table public.food_entries drop constraint if exists food_entries_product_owner_fkey;
alter table public.food_entries
  add constraint food_entries_product_owner_fkey
  foreign key (product_id, user_id) references public.food_products (id, user_id)
  on delete set null (product_id);

-- ── Сводка по дню (RPC) ────────────────────────────────────────
-- Клиент считает итоги и сам, но RPC полезна для проверки/статистики.
create or replace function public.food_day_summary(from_date date, to_date date)
returns table (
  date        date,
  kcal        numeric,
  protein     numeric,
  fat         numeric,
  carbs       numeric,
  entries     bigint
)
language sql
security invoker
set search_path = ''
stable
as $$
  select
    e.date,
    sum(e.kcal)    as kcal,
    sum(e.protein) as protein,
    sum(e.fat)     as fat,
    sum(e.carbs)   as carbs,
    count(*)       as entries
  from public.food_entries e
  where e.user_id = auth.uid()
    and e.date between from_date and to_date
  group by e.date
  order by e.date;
$$;

grant execute on function public.food_day_summary(date, date) to authenticated;

notify pgrst, 'reload schema';
