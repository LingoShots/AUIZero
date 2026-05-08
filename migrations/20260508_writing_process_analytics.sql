-- Writing process evidence derived-data tables.
--
-- Raw writing events stay on public.submissions.writing_events. These tables
-- store derived, versioned analysis snapshots and teacher/admin labels so the
-- analysis pipeline can evolve without rewriting student submissions.

create table if not exists public.submission_process_analyses (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete cascade,
  class_id uuid references public.classes(id) on delete cascade,
  student_id uuid references public.profiles(id) on delete cascade,
  analysis_version text not null,
  input_hash text not null,
  process_status text not null,
  process_status_label text not null,
  reason text not null default '',
  metrics jsonb not null default '{}'::jsonb,
  timeline jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  paste_evidence jsonb not null default '[]'::jsonb,
  cohort_comparison jsonb not null default '{}'::jsonb,
  coach_baseline jsonb not null default '{}'::jsonb,
  excluded_from_analytics boolean not null default false,
  exclusion_sources jsonb not null default '[]'::jsonb,
  calculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint submission_process_analyses_submission_unique unique (submission_id)
);

create index if not exists submission_process_analyses_assignment_idx
on public.submission_process_analyses (assignment_id);

create index if not exists submission_process_analyses_class_idx
on public.submission_process_analyses (class_id);

create index if not exists submission_process_analyses_student_idx
on public.submission_process_analyses (student_id);

create index if not exists submission_process_analyses_version_idx
on public.submission_process_analyses (analysis_version);

create index if not exists submission_process_analyses_included_idx
on public.submission_process_analyses (excluded_from_analytics);

create table if not exists public.submission_process_labels (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  analysis_id uuid references public.submission_process_analyses(id) on delete set null,
  reviewer_id uuid references public.profiles(id) on delete set null,
  label text not null,
  notes text not null default '',
  excluded_from_training boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists submission_process_labels_submission_idx
on public.submission_process_labels (submission_id);

create index if not exists submission_process_labels_reviewer_idx
on public.submission_process_labels (reviewer_id);

create table if not exists public.writing_process_cohort_stats (
  id uuid primary key default gen_random_uuid(),
  analysis_version text not null,
  cohort_key text not null,
  cohort_label text not null,
  sample_size integer not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  constraint writing_process_cohort_stats_version_key_unique unique (analysis_version, cohort_key)
);

alter table public.submission_process_analyses enable row level security;
alter table public.submission_process_labels enable row level security;
alter table public.writing_process_cohort_stats enable row level security;

drop policy if exists "Teachers can view process analyses for own assignments" on public.submission_process_analyses;
create policy "Teachers can view process analyses for own assignments"
on public.submission_process_analyses
for select
to authenticated
using (
  public.current_user_owns_assignment(assignment_id)
  or public.current_user_is_admin()
  or auth.uid() = student_id
);

drop policy if exists "Admins can manage process analyses" on public.submission_process_analyses;
create policy "Admins can manage process analyses"
on public.submission_process_analyses
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Teachers can view process labels for own assignments" on public.submission_process_labels;
create policy "Teachers can view process labels for own assignments"
on public.submission_process_labels
for select
to authenticated
using (
  public.current_user_is_admin()
  or exists (
    select 1
    from public.submissions
    where submissions.id = submission_process_labels.submission_id
      and public.current_user_owns_assignment(submissions.assignment_id)
  )
);

drop policy if exists "Teachers can insert process labels for own assignments" on public.submission_process_labels;
create policy "Teachers can insert process labels for own assignments"
on public.submission_process_labels
for insert
to authenticated
with check (
  public.current_user_is_admin()
  or (
    reviewer_id = auth.uid()
    and exists (
      select 1
      from public.submissions
      where submissions.id = submission_process_labels.submission_id
        and public.current_user_owns_assignment(submissions.assignment_id)
    )
  )
);

drop policy if exists "Admins can manage process labels" on public.submission_process_labels;
create policy "Admins can manage process labels"
on public.submission_process_labels
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());

drop policy if exists "Admins can view writing process cohort stats" on public.writing_process_cohort_stats;
create policy "Admins can view writing process cohort stats"
on public.writing_process_cohort_stats
for select
to authenticated
using (public.current_user_is_admin());

drop policy if exists "Admins can manage writing process cohort stats" on public.writing_process_cohort_stats;
create policy "Admins can manage writing process cohort stats"
on public.writing_process_cohort_stats
for all
to authenticated
using (public.current_user_is_admin())
with check (public.current_user_is_admin());
