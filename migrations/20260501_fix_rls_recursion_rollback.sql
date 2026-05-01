-- Roll back 20260501_fix_rls_recursion.sql.
--
-- Restores the policy definitions observed before the recursion hotfix. This
-- rollback changes policies/functions only; it does not alter table data.

alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;

-- classes
drop policy if exists "Students can view classes they belong to" on public.classes;
drop policy if exists "Teachers can select own classes" on public.classes;
drop policy if exists "Teachers can insert classes" on public.classes;
drop policy if exists "Teachers can update own classes" on public.classes;
drop policy if exists "Teachers can delete own classes" on public.classes;
drop policy if exists "Admins can select classes" on public.classes;

create policy "Students can view classes they belong to"
on public.classes
for select
to public
using (
  exists (
    select 1
    from public.class_members cm
    where cm.class_id = classes.id
      and cm.student_id = auth.uid()
  )
);

create policy "Teachers can select own classes"
on public.classes
for select
to public
using (auth.uid() = teacher_id);

create policy "Teachers can insert classes"
on public.classes
for insert
to public
with check (auth.uid() = teacher_id);

create policy "Teachers can update own classes"
on public.classes
for update
to public
using (auth.uid() = teacher_id);

create policy "Teachers can delete own classes"
on public.classes
for delete
to public
using (auth.uid() = teacher_id);

-- class_members
drop policy if exists "Students can view own memberships" on public.class_members;
drop policy if exists "Teachers can select class members" on public.class_members;
drop policy if exists "Teachers can insert class members" on public.class_members;
drop policy if exists "Teachers can update class members" on public.class_members;
drop policy if exists "Teachers can delete class members" on public.class_members;
drop policy if exists "Admins can select class members" on public.class_members;

create policy "Students can view own memberships"
on public.class_members
for select
to public
using (auth.uid() = student_id);

create policy "Teachers can select class members"
on public.class_members
for select
to public
using (
  exists (
    select 1
    from public.classes c
    where c.id = class_members.class_id
      and c.teacher_id = auth.uid()
  )
);

create policy "Teachers can insert class members"
on public.class_members
for insert
to public
with check (
  exists (
    select 1
    from public.classes c
    where c.id = class_members.class_id
      and c.teacher_id = auth.uid()
  )
);

create policy "Teachers can delete class members"
on public.class_members
for delete
to public
using (
  exists (
    select 1
    from public.classes c
    where c.id = class_members.class_id
      and c.teacher_id = auth.uid()
  )
);

-- assignments
drop policy if exists "Students can view published assignments in their classes" on public.assignments;
drop policy if exists "Teachers can manage own assignments" on public.assignments;
drop policy if exists "Teachers can insert own assignments" on public.assignments;
drop policy if exists "Teachers can update own assignments" on public.assignments;
drop policy if exists "Teachers can delete own assignments" on public.assignments;
drop policy if exists "Admins can select assignments" on public.assignments;

create policy "Students can view published assignments in their classes"
on public.assignments
for select
to public
using (
  status = 'published'::text
  and exists (
    select 1
    from public.class_members
    where class_members.class_id = assignments.class_id
      and class_members.student_id = auth.uid()
  )
);

create policy "Teachers can manage own assignments"
on public.assignments
for all
to public
using (
  exists (
    select 1
    from public.classes
    where classes.id = assignments.class_id
      and classes.teacher_id = auth.uid()
  )
);

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

-- submissions
drop policy if exists "Teachers can view submissions in their assignments" on public.submissions;
drop policy if exists "Teachers can update submissions in their assignments" on public.submissions;
drop policy if exists "Teachers can insert submissions in their assignments" on public.submissions;
drop policy if exists "Admins can select submissions" on public.submissions;

create policy "Teachers can view submissions in their assignments"
on public.submissions
for select
to public
using (
  exists (
    select 1
    from public.assignments a
    join public.classes c on c.id = a.class_id
    where a.id = submissions.assignment_id
      and c.teacher_id = auth.uid()
  )
);

create policy "Teachers can update submissions in their assignments"
on public.submissions
for update
to public
using (
  exists (
    select 1
    from public.assignments a
    join public.classes c on c.id = a.class_id
    where a.id = submissions.assignment_id
      and c.teacher_id = auth.uid()
  )
);

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

drop function if exists public.student_belongs_to_assignment_class(uuid, uuid);
drop function if exists public.current_user_owns_assignment(uuid);
drop function if exists public.current_user_is_class_member(uuid);
drop function if exists public.current_user_owns_class(uuid);
drop function if exists public.current_user_is_admin();
