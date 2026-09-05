-- HackerRank Admin Dashboard — Supabase / Postgres schema (with hc_ prefix).
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).

create table if not exists hc_colleges (
  id           bigint generated always as identity primary key,
  name         text unique,
  access_code  text,
  contest_url  text,
  slug         text,
  created_at   timestamptz default now()
);

create table if not exists hc_students (
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

create table if not exists hc_contests (
  id           bigint generated always as identity primary key,
  college      text,
  name         text,
  contest_url  text,
  slug         text,
  share_token  text,
  created_at   timestamptz default now()
);

create table if not exists hc_contest_students (
  contest_id   bigint,
  username_key text,
  primary key (contest_id, username_key)
);

create table if not exists hc_scrapes (
  id              bigint generated always as identity primary key,
  slug            text,
  contest_name    text,
  total_users     int,
  total_questions int,
  payload         jsonb,
  created_at      timestamptz default now()
);

create table if not exists hc_topics (
  slug     text,
  question text,
  topic    text,
  primary key (slug, question)
);

create table if not exists hc_topic_videos (
  slug      text,
  topic     text,
  video_url text,
  primary key (slug, topic)
);

create table if not exists hc_question_categories (
  slug     text,
  question text,
  category text,
  primary key (slug, question)
);

create table if not exists hc_app_settings (
  key   text primary key,
  value text
);

-- Helpful indexes
create index if not exists idx_hc_students_college on hc_students (college);
create index if not exists idx_hc_students_college_name on hc_students (college, name);
create index if not exists idx_hc_contests_college on hc_contests (college);
create index if not exists idx_hc_contests_share_token on hc_contests (share_token);
create index if not exists idx_hc_contest_students_contest on hc_contest_students (contest_id);
create index if not exists idx_hc_scrapes_slug_id on hc_scrapes (slug, id desc);
create index if not exists idx_hc_topics_slug on hc_topics (slug);
create index if not exists idx_hc_topic_videos_slug on hc_topic_videos (slug);
create index if not exists idx_hc_qcat_slug on hc_question_categories (slug);
