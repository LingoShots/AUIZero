# Production E2E Test Data Cleanup Audit

Date: 2026-05-02

Scope: read-only audit for production Supabase project `bfnpumsdoevheqskcdec`.

No delete, update, or migration SQL was run during this audit.

## Target Scope

Test class:

```text
1bd11112-fb3b-4fa3-8317-e30dda9881bc
```

Target assignment pattern:

```sql
title like 'E2E Test Assignment %'
```

Scoped target count:

```text
22 assignments
22 submissions
```

Date range:

```text
Earliest created_at: 2026-05-01 23:16:31.114867+00
Latest created_at:   2026-05-02 16:13:46.747062+00
```

## Related Tables

The production `public` schema currently has five app tables:

```text
profiles
classes
class_members
assignments
submissions
```

Assignment/submission-related data is stored in:

```text
assignments
submissions
```

There are no separate public tables for keystroke events, chat history, feedback history, rubric scores, teacher reviews, or self-assessment scores. Those are embedded as JSON/JSONB columns on `submissions`.

Relevant `submissions` embedded data columns:

```text
chat_history
writing_events
feedback_history
focus_annotations
teacher_review
self_assessment
idea_responses
outline
keystroke_log
fluency_summary
```

Deleting the target `assignments` rows will also delete their `submissions` rows by foreign-key cascade, and that removes the embedded JSON data above.

## Foreign Key Chain

| Constraint | Source | Target | ON DELETE |
| --- | --- | --- | --- |
| `assignments_class_id_fkey` | `assignments.class_id` | `classes.id` | `CASCADE` |
| `submissions_assignment_id_fkey` | `submissions.assignment_id` | `assignments.id` | `CASCADE` |
| `submissions_student_id_fkey` | `submissions.student_id` | `profiles.id` | `CASCADE` |
| `class_members_class_id_fkey` | `class_members.class_id` | `classes.id` | `CASCADE` |
| `class_members_student_id_fkey` | `class_members.student_id` | `profiles.id` | `CASCADE` |
| `classes_teacher_id_fkey` | `classes.teacher_id` | `profiles.id` | `CASCADE` |

Cleanup implication:

```text
Delete target assignments only.
Their submissions cascade automatically.
Do not delete class_members, classes, or profiles for this cleanup.
```

## Target Assignment Listing

Read-only query:

```sql
select
  a.id as assignment_id,
  a.title,
  a.status as assignment_status,
  a.created_at,
  count(s.id) as submission_count,
  count(s.id) filter (where s.status = 'draft') as draft_submissions,
  count(s.id) filter (where s.status = 'submitted') as submitted_submissions,
  count(s.id) filter (where s.status = 'graded') as graded_submissions
from public.assignments a
left join public.submissions s on s.assignment_id = a.id
where a.class_id = '1bd11112-fb3b-4fa3-8317-e30dda9881bc'
  and a.title like 'E2E Test Assignment %'
group by a.id, a.title, a.status, a.created_at
order by a.created_at desc;
```

Result summary:

| Assignment ID | Title | Status | Created At | Submissions | Draft | Submitted | Graded |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| `d7358018-984d-4089-a5d8-1657e32a2d94` | E2E Test Assignment 1777738414577 | published | 2026-05-02 16:13:46.747062+00 | 1 | 0 | 1 | 0 |
| `1e6f69ca-dda0-4cf8-a40f-c4e2b9f5f10c` | E2E Test Assignment 1777738273657 | published | 2026-05-02 16:11:26.960077+00 | 1 | 0 | 1 | 0 |
| `83eb14a7-cdf5-4d5d-89f2-11e885641135` | E2E Test Assignment 1777733551186 | published | 2026-05-02 14:52:42.799709+00 | 1 | 0 | 1 | 0 |
| `bb94035e-989f-4e16-94cd-b8a827561e5f` | E2E Test Assignment 1777733494459 | published | 2026-05-02 14:51:49.409243+00 | 1 | 0 | 1 | 0 |
| `e798039d-7a72-4105-9075-acac41b63b34` | E2E Test Assignment 1777731362068 | published | 2026-05-02 14:16:14.363786+00 | 1 | 0 | 1 | 0 |
| `34ef2421-6325-4fa2-9cae-06c63651720a` | E2E Test Assignment 1777731219922 | published | 2026-05-02 14:13:55.539272+00 | 1 | 0 | 1 | 0 |
| `5faee332-776b-49dd-ac27-0ee87ea75435` | E2E Test Assignment 1777727439901 | published | 2026-05-02 13:10:53.557444+00 | 1 | 0 | 1 | 0 |
| `fc3bd02a-1d05-467d-915a-b1e62d777bec` | E2E Test Assignment 1777727318871 | published | 2026-05-02 13:08:51.264576+00 | 1 | 0 | 1 | 0 |
| `74f5bd74-9deb-44df-99ad-d8efbed8e9a1` | E2E Test Assignment 1777726431728 | published | 2026-05-02 12:54:03.402675+00 | 1 | 0 | 1 | 0 |
| `84602490-cfcb-4766-a4a8-a63b99882c89` | E2E Test Assignment 1777726310901 | published | 2026-05-02 12:52:05.842644+00 | 1 | 0 | 1 | 0 |
| `6df074ed-2204-4905-b949-9a64a86abedd` | E2E Test Assignment 1777712378227 | published | 2026-05-02 08:59:50.041567+00 | 1 | 0 | 1 | 0 |
| `9c211c01-4400-425e-9064-a26d075720b5` | E2E Test Assignment 1777712257165 | published | 2026-05-02 08:57:49.311114+00 | 1 | 0 | 1 | 0 |
| `6350d7a5-b030-462c-9b8d-33774121d6c3` | E2E Test Assignment 1777711536731 | published | 2026-05-02 08:45:47.247615+00 | 1 | 1 | 0 | 0 |
| `9de01cfa-40c1-42ee-ba89-f6f136c6419a` | E2E Test Assignment 1777711469919 | published | 2026-05-02 08:44:43.437785+00 | 1 | 1 | 0 | 0 |
| `527cbc62-b8fa-49ac-af3d-7cbddd2e9cc8` | E2E Test Assignment 1777709448149 | published | 2026-05-02 08:10:59.616538+00 | 1 | 1 | 0 | 0 |
| `ca49ecdd-40ea-4b4b-ba00-814c14161290` | E2E Test Assignment 1777709406186 | published | 2026-05-02 08:10:19.94519+00 | 1 | 1 | 0 | 0 |
| `45a48093-94f3-4d46-b7ee-a141874df206` | E2E Test Assignment 1777708476705 | published | 2026-05-02 07:54:51.179874+00 | 1 | 1 | 0 | 0 |
| `754bfea0-e76e-48a4-885b-3286ba97c836` | E2E Test Assignment 1777708355721 | published | 2026-05-02 07:52:49.086542+00 | 1 | 1 | 0 | 0 |
| `ead22d26-aa8d-4cb8-bd9c-e1ca0639d30e` | E2E Test Assignment 1777707334640 | published | 2026-05-02 07:35:47.202953+00 | 1 | 1 | 0 | 0 |
| `213214c1-ad20-466f-ae6d-f4fd25d30053` | E2E Test Assignment 1777707213602 | published | 2026-05-02 07:33:47.166838+00 | 1 | 1 | 0 | 0 |
| `c9e9fffe-d7f6-419a-ac70-7fb5e82bdc5e` | E2E Test Assignment 1777677506867 | published | 2026-05-01 23:18:32.0111+00 | 1 | 1 | 0 | 0 |
| `da3cf95d-3935-4260-827f-9b2f6dc543a4` | E2E Test Assignment 1777677385885 | published | 2026-05-01 23:16:31.114867+00 | 1 | 1 | 0 | 0 |

## Submission Breakdown

Read-only query:

```sql
with test_assignments as (
  select id
  from public.assignments
  where class_id = '1bd11112-fb3b-4fa3-8317-e30dda9881bc'
    and title like 'E2E Test Assignment %'
)
select
  coalesce(p.name, '(missing profile)') as student_name,
  p.id as student_id,
  count(*) as submission_count,
  count(*) filter (where s.status = 'draft') as draft_count,
  count(*) filter (where s.status = 'submitted') as submitted_count,
  count(*) filter (where s.status = 'graded') as graded_count
from public.submissions s
join test_assignments a on a.id = s.assignment_id
left join public.profiles p on p.id = s.student_id
group by p.id, p.name
order by submission_count desc, student_name;
```

Result:

| Student | Student ID | Submissions | Draft | Submitted | Graded |
| --- | --- | ---: | ---: | ---: | ---: |
| Test Student5 | `dadd7da4-218a-4dd5-9b62-30c54c12e475` | 22 | 10 | 12 | 0 |

Embedded data summary for the 22 submissions:

| Field | Rows With Data |
| --- | ---: |
| `chat_history` | 22 |
| `writing_events` | 22 |
| `feedback_history` | 12 |
| `focus_annotations` | 0 |
| `keystroke_log` | 0 |
| `teacher_review` | 0 |
| `self_assessment` | 12 |
| `fluency_summary` | 12 |

## Recommended Cleanup Plan

Because `submissions.assignment_id -> assignments.id` uses `ON DELETE CASCADE`, the cleanest manual cleanup is a single scoped assignment delete.

Suggested preview query:

```sql
select id, title, status, created_at
from public.assignments
where class_id = '1bd11112-fb3b-4fa3-8317-e30dda9881bc'
  and title like 'E2E Test Assignment %'
order by created_at desc;
```

Suggested delete plan for Supabase SQL Editor:

```sql
begin;

with target_assignments as (
  select id
  from public.assignments
  where class_id = '1bd11112-fb3b-4fa3-8317-e30dda9881bc'
    and title like 'E2E Test Assignment %'
),
deleted_assignments as (
  delete from public.assignments
  where id in (select id from target_assignments)
  returning id, title
)
select count(*) as deleted_assignment_count
from deleted_assignments;

commit;
```

Expected result:

```text
deleted_assignment_count = 22
```

Expected cascade effect:

```text
22 submissions deleted automatically.
All embedded chat, writing events, feedback history, self-assessment, and fluency data for those submissions removed with the submissions rows.
```

Optional post-cleanup verification:

```sql
select count(*) as remaining_e2e_assignments
from public.assignments
where class_id = '1bd11112-fb3b-4fa3-8317-e30dda9881bc'
  and title like 'E2E Test Assignment %';

with target_assignments as (
  select id
  from public.assignments
  where class_id = '1bd11112-fb3b-4fa3-8317-e30dda9881bc'
    and title like 'E2E Test Assignment %'
)
select count(*) as remaining_e2e_submissions
from public.submissions s
join target_assignments a on a.id = s.assignment_id;
```

Both should return `0`.

## Conservative Alternative

If you prefer not to rely on cascade behavior, this explicit order is also valid:

```sql
begin;

with target_assignments as (
  select id
  from public.assignments
  where class_id = '1bd11112-fb3b-4fa3-8317-e30dda9881bc'
    and title like 'E2E Test Assignment %'
)
delete from public.submissions
where assignment_id in (select id from target_assignments);

delete from public.assignments
where class_id = '1bd11112-fb3b-4fa3-8317-e30dda9881bc'
  and title like 'E2E Test Assignment %';

commit;
```

The single-statement assignment delete is preferable because the FK already guarantees the submission cleanup.
