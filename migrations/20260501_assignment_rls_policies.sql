alter table public.assignments enable row level security;

drop policy if exists "Teachers can insert own assignments" on public.assignments;
create policy "Teachers can insert own assignments"
on public.assignments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.classes
    where classes.id = assignments.class_id
      and classes.teacher_id = auth.uid()
  )
);

drop policy if exists "Teachers can update own assignments" on public.assignments;
create policy "Teachers can update own assignments"
on public.assignments
for update
to authenticated
using (
  exists (
    select 1
    from public.classes
    where classes.id = assignments.class_id
      and classes.teacher_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.classes
    where classes.id = assignments.class_id
      and classes.teacher_id = auth.uid()
  )
);

drop policy if exists "Teachers can delete own assignments" on public.assignments;
create policy "Teachers can delete own assignments"
on public.assignments
for delete
to authenticated
using (
  exists (
    select 1
    from public.classes
    where classes.id = assignments.class_id
      and classes.teacher_id = auth.uid()
  )
);
