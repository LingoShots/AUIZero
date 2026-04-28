module.exports = {
  roster: [
    { id: "student-1", name: "Ada" },
    { id: "student-2", name: "Ben" },
    { id: "student-3", name: "Cleo" },
  ],
  assignments: [
    { id: "assignment-1", title: "First essay" },
    { id: "assignment-2", title: "Second essay" },
    { id: "assignment-3", title: "Process paragraph" },
  ],
  submissions: [
    {
      id: "sub-1",
      assignmentId: "assignment-1",
      studentId: "student-1",
      status: "submitted",
      submittedAt: "2026-04-28T14:00:00.000Z",
      finalText: "Finished work.",
    },
    {
      id: "sub-2",
      assignmentId: "assignment-1",
      studentId: "student-2",
      status: "draft",
      draftText: "Still working.",
    },
    {
      id: "sub-3",
      assignmentId: "assignment-1",
      studentId: "student-3",
      status: "missing",
      teacherReview: { status: "missing" },
    },
    {
      id: "sub-4",
      assignmentId: "assignment-2",
      studentId: "student-1",
      status: "submitted",
      submittedAt: "2026-04-28T15:00:00.000Z",
      teacherReview: {
        status: "graded",
        finalScore: 18,
        savedAt: "2026-04-28T16:00:00.000Z",
      },
    },
    {
      id: "sub-5",
      assignmentId: "assignment-2",
      studentId: "student-2",
      status: "draft",
      submittedAt: "2026-04-28T15:10:00.000Z",
      finalText: "Submitted even though the status lagged.",
    },
    {
      id: "sub-6",
      assignment_id: "assignment-3",
      student_id: "student-1",
      status: "late",
      submitted_at: null,
      final_text: "",
    },
  ],
};
