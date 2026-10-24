-- Discussion forum schema for the CSE 435 LMS1 team website.
-- Run this once in the Supabase SQL Editor (Supabase dashboard -> SQL Editor -> New query).

create table threads (
  id          uuid primary key default gen_random_uuid(),
  author      text not null check (char_length(author) between 1 and 60),
  title       text not null check (char_length(title)  between 1 and 140),
  status      text not null default 'open' check (status in ('open','customer','resolved')),
  body        text not null check (char_length(body)   between 1 and 4000),
  created_at  timestamptz not null default now()
);

create table replies (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references threads(id) on delete cascade,
  author      text not null check (char_length(author) between 1 and 60),
  body        text not null check (char_length(body)   between 1 and 4000),
  created_at  timestamptz not null default now()
);

create index replies_thread_id_idx on replies(thread_id);

-- Row Level Security.
-- The anon key is visible in the page source, so these policies are what
-- actually limit what a visitor can do. Reading and posting are allowed;
-- editing and deleting are not, so existing posts cannot be altered from
-- the browser. Use the Supabase dashboard to remove a post if needed.
alter table threads enable row level security;
alter table replies enable row level security;

create policy "anyone can read threads"  on threads for select using (true);
create policy "anyone can post threads"  on threads for insert with check (true);
create policy "anyone can read replies"  on replies for select using (true);
create policy "anyone can post replies"  on replies for insert with check (true);

-- Table privileges.
-- RLS policies decide which ROWS a role may touch, but the role also needs
-- Postgres-level privileges on the table itself. Without these, requests fail
-- with "permission denied for table threads" before the policies are checked.
-- Select and insert only, so posts cannot be edited or deleted from the browser.
grant usage on schema public to anon;
grant select, insert on table threads to anon;
grant select, insert on table replies to anon;
