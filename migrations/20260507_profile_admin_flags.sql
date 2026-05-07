alter table public.profiles
  add column if not exists is_test_account boolean not null default false,
  add column if not exists exclude_from_writing_behavior boolean not null default false;
