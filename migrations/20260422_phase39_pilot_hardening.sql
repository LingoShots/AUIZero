alter table public.submissions
  add column if not exists idea_responses jsonb not null default '[]'::jsonb,
  add column if not exists outline jsonb not null default '{"partOne":"","partTwo":"","partThree":""}'::jsonb,
  add column if not exists chat_skipped_at timestamp with time zone,
  add column if not exists chat_expired_at timestamp with time zone,
  add column if not exists chat_elapsed_ms integer not null default 0;

alter table public.submissions
  drop constraint if exists submissions_status_check;

alter table public.submissions
  add constraint submissions_status_check
  check (status = any (array['draft'::text, 'submitted'::text, 'graded'::text, 'late'::text, 'missing'::text]));

alter table public.class_members
  drop constraint if exists class_members_class_id_student_id_key;

alter table public.class_members
  add constraint class_members_class_id_student_id_key unique (class_id, student_id);
