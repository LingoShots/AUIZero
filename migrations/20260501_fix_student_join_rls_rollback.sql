-- Roll back 20260501_fix_student_join_rls.sql.

drop policy if exists "Students can insert own memberships" on public.class_members;
