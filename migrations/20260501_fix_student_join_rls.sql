-- Allow students to accept class invites by inserting only their own membership.
--
-- This is intentionally narrow: students may create a class_members row only
-- when the row's student_id is their authenticated user id. Teacher/admin
-- roster management remains covered by the existing teacher/admin policies.

alter table public.class_members enable row level security;

drop policy if exists "Students can insert own memberships" on public.class_members;
create policy "Students can insert own memberships"
on public.class_members
for insert
to authenticated
with check (auth.uid() = student_id);
