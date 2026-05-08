drop policy if exists "Admins can manage writing process cohort stats" on public.writing_process_cohort_stats;
drop policy if exists "Admins can view writing process cohort stats" on public.writing_process_cohort_stats;
drop policy if exists "Admins can manage process labels" on public.submission_process_labels;
drop policy if exists "Teachers can insert process labels for own assignments" on public.submission_process_labels;
drop policy if exists "Teachers can view process labels for own assignments" on public.submission_process_labels;
drop policy if exists "Admins can manage process analyses" on public.submission_process_analyses;
drop policy if exists "Teachers can view process analyses for own assignments" on public.submission_process_analyses;

drop table if exists public.writing_process_cohort_stats;
drop table if exists public.submission_process_labels;
drop table if exists public.submission_process_analyses;
