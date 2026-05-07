alter table public.profiles
  drop column if exists exclude_from_writing_behavior,
  drop column if exists is_test_account;
