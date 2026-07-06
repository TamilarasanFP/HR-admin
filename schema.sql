-- HackerRank Admin Dashboard — Supabase / Postgres schema.
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).

create table if not exists colleges (
  id           bigint generated always as identity primary key,
  name         text unique,
  access_code  text,
  contest_url  text,
  slug         text,
  created_at   timestamptz default now()
);

create table if not exists students (
  id           bigint generated always as identity primary key,
  college      text,
  name         text,
  hr_username  text,
  username_key text,
  register_no  text,
  email        text,
  department   text,
  section      text,
  year         text,
  campus       text,
  unique (college, username_key)
);

create table if not exists contests (
  id           bigint generated always as identity primary key,
  college      text,
  name         text,
  contest_url  text,
  slug         text,
  share_token  text,
  created_at   timestamptz default now()
);

create table if not exists contest_students (
  contest_id   bigint,
  username_key text,
  primary key (contest_id, username_key)
);

create table if not exists scrapes (
  id              bigint generated always as identity primary key,
  slug            text,
  contest_name    text,
  total_users     int,
  total_questions int,
  payload         jsonb,
  created_at      timestamptz default now()
);

create table if not exists topics (
  slug     text,
  question text,
  topic    text,
  primary key (slug, question)
);

create table if not exists topic_videos (
  slug      text,
  topic     text,
  video_url text,
  primary key (slug, topic)
);

create table if not exists question_categories (
  slug     text,
  question text,
  category text,
  primary key (slug, question)
);

-- Helpful indexes
create index if not exists idx_students_college on students (college);
create index if not exists idx_contests_college on contests (college);
create index if not exists idx_scrapes_slug on scrapes (slug);
create index if not exists idx_contest_students_contest on contest_students (contest_id);
