-- Fix recursive RLS checks between classes and class_members.
--
-- This migration deliberately changes only policy/function definitions. It does
-- not alter table structure or existing data.

alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;

create or replace function public.current_user_is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function public.current_user_owns_class(target_class_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.classes
    where id = target_class_id
      and teacher_id = auth.uid()
  );
$$;

create or replace function public.current_user_is_class_member(target_class_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.class_members
    where class_id = target_class_id
      and student_id = auth.uid()
  );
$$;

create or replace function public.current_user_owns_assignment(target_assignment_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.assignments
    join public.classes on classes.id = assignments.class_id
    where assignments.id = target_assignment_id
      and classes.teacher_id = auth.uid()
  );
$$;

create or replace function public.student_belongs_to_assignment_class(
  target_assignment_id uuid,
  target_student_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select (
    target_student_id = auth.uid()
    or public.current_user_owns_assignment(target_assignment_id)
    or public.current_user_is_admin()
  )
  and exists (
    select 1
    from public.assignments
    join public.class_members on class_members.class_id = assignments.class_id
    where assignments.id = target_assignment_id
      and class_members.student_id = target_student_id
  );
$$;

revoke all on function public.current_user_is_admin() from public;
revoke all on function public.current_user_owns_class(uuid) from public;
revoke all on function public.current_user_is_class_member(uuid) from public;
revoke all on function public.current_user_owns_assignment(uuid) from public;
revoke all on function public.student_belongs_to_assignment_class(uuid, uuid) from public;

grant execute on function public.current_user_is_admin() to authenticated;
grant execute on function public.current_user_owns_class(uuid) to authenticated;
grant execute on function public.current_user_is_class_member(uuid) to authenticated;
grant execute on function public.current_user_owns_assignment(uuid) to authenticated;
grant execute on function public.student_belongs_to_assignment_class(uuid, uuid) to authenticated;

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
to authenticated
using (public.current_user_is_class_member(id));

create policy "Teachers can select own classes"
on public.classes
for select
to authenticated
using (auth.uid() = teacher_id);

create policy "Admins can select classes"
on public.classes
for select
to authenticated
using (public.current_user_is_admin());

create policy "Teachers can insert classes"
on public.classes
for insert
to authenticated
with check (auth.uid() = teacher_id);

create policy "Teachers can update own classes"
on public.classes
for update
to authenticated
using (auth.uid() = teacher_id)
with check (auth.uid() = teacher_id);

create policy "Teachers can delete own classes"
on public.classes
for delete
to authenticated
using (auth.uid() = teacher_id);

-- class_members
drop policy if exists "Students can view own memberships" on public.class_members;
drop policy if exists "Teachers can select class members" on public.class_members;
drop policy if exists "Teachers can insert class members" on public.class_members;
drop policy if exists "Teachers can delete class members" on public.class_members;
drop policy if exists "Teachers can update class members" on public.class_members;
drop policy if exists "Admins can select class members" on public.class_members;

create policy "Students can view own memberships"
on public.class_members
for select
to authenticated
using (auth.uid() = student_id);

create policy "Teachers can select class members"
on public.class_members
for select
to authenticated
using (public.current_user_owns_class(class_id));

create policy "Admins can select class members"
on public.class_members
for select
to authenticated
using (public.current_user_is_admin());

create policy "Teachers can insert class members"
on public.class_members
for insert
to authenticated
with check (public.current_user_owns_class(class_id));

create policy "Teachers can update class members"
on public.class_members
for update
to authenticated
using (public.current_user_owns_class(class_id))
with check (public.current_user_owns_class(class_id));

create policy "Teachers can delete class members"
on public.class_members
for delete
to authenticated
using (public.current_user_owns_class(class_id));

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
to authenticated
using (
  status = 'published'
  and public.current_user_is_class_member(class_id)
);

create policy "Teachers can manage own assignments"
on public.assignments
for all
to authenticated
using (public.current_user_owns_class(class_id))
with check (public.current_user_owns_class(class_id));

create policy "Admins can select assignments"
on public.assignments
for select
to authenticated
using (public.current_user_is_admin());

-- submissions
-- Student insert/update policies are intentionally left in place.
drop policy if exists "Teachers can view submissions in their assignments" on public.submissions;
drop policy if exists "Teachers can update submissions in their assignments" on public.submissions;
drop policy if exists "Teachers can insert submissions in their assignments" on public.submissions;
drop policy if exists "Admins can select submissions" on public.submissions;

create policy "Teachers can view submissions in their assignments"
on public.submissions
for select
to authenticated
using (public.current_user_owns_assignment(assignment_id));

create policy "Admins can select submissions"
on public.submissions
for select
to authenticated
using (public.current_user_is_admin());

create policy "Teachers can update submissions in their assignments"
on public.submissions
for update
to authenticated
using (public.current_user_owns_assignment(assignment_id))
with check (public.current_user_owns_assignment(assignment_id));

create policy "Teachers can insert submissions in their assignments"
on public.submissions
for insert
to authenticated
with check (
  public.current_user_owns_assignment(assignment_id)
  and public.student_belongs_to_assignment_class(assignment_id, student_id)
);
