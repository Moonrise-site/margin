-- Margin sync: paste all of this into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.

-- 1. One table holds every synced item. Contents are encrypted on your devices
--    before upload, so this only ever stores scrambled text.
create table if not exists public.margin_items (
  user_id   uuid        not null default auth.uid() references auth.users on delete cascade,
  id        text        not null,
  kind      text        not null,
  updated   bigint      not null,
  deleted   boolean     not null default false,
  data      text,
  server_ts timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists margin_items_user_ts on public.margin_items (user_id, server_ts);

-- Stamp every write with the server's clock (used to fetch only what changed).
create or replace function public.margin_touch() returns trigger
language plpgsql as $$ begin new.server_ts := clock_timestamp(); return new; end $$;
drop trigger if exists margin_touch on public.margin_items;
create trigger margin_touch before insert or update on public.margin_items
  for each row execute function public.margin_touch();

-- 2. Each account can only see and change its own rows.
alter table public.margin_items enable row level security;
drop policy if exists "margin own rows" on public.margin_items;
create policy "margin own rows" on public.margin_items
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3. A private bucket for (encrypted) images, one folder per account.
insert into storage.buckets (id, name, public) values ('margin', 'margin', false)
  on conflict (id) do nothing;
drop policy if exists "margin own files" on storage.objects;
create policy "margin own files" on storage.objects
  for all to authenticated
  using (bucket_id = 'margin' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'margin' and (storage.foldername(name))[1] = auth.uid()::text);
