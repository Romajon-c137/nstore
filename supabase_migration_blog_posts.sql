-- Таблица блога (перенос статей со старого сайта + будущие публикации).
-- Публичное чтение только активных статей; запись — через service_role.

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  excerpt text,
  body_html text,
  cover_image text,
  author text,
  published_at timestamptz default now(),
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists blog_posts_active_pub_idx on public.blog_posts (is_active, published_at desc);

alter table public.blog_posts enable row level security;

drop policy if exists "blog_posts public read active" on public.blog_posts;
create policy "blog_posts public read active"
  on public.blog_posts for select
  to anon, authenticated
  using (is_active = true);
