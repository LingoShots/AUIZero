alter table public.submissions enable row level security;

drop policy if exists "Students can insert own submissions" on public.submissions;
create policy "Students can insert own submissions"
on public.submissions
for insert
to authenticated
with check (
  auth.uid() = student_id
);

drop policy if exists "Students can update own submissions" on public.submissions;
create policy "Students can update own submissions"
on public.submissions
for update
to authenticated
using (
  auth.uid() = student_id
)
with check (
  auth.uid() = student_id
);

drop policy if exists "Teachers can insert submissions in their assignments" on public.submissions;
create policy "Teachers can insert submissions in their assignments"
on public.submissions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.assignments
    join public.classes on classes.id = assignments.class_id
    join public.class_members on class_members.class_id = classes.id
    where assignments.id = submissions.assignment_id
      and classes.teacher_id = auth.uid()
      and class_members.student_id = submissions.student_id
  )
);
