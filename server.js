require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const { parseRubricBuffer, parseRubricText } = require('./rubricParser');
const { analyzeSubmission } = require('./writing-process/analyze');
const {
  appendResetQuery,
  getTeacherReviewSavedAt,
  submissionWasReopened,
  submissionPayloadWithGradedStatus,
  teacherReviewWasNewlySaved,
} = require('./notification-utils');
const {
  createOpenTeacherReview,
  normalizeStudentVisibleSubmission,
  sanitizeStudentSubmissionPayload,
  sanitizeTeacherSubmissionPayload,
} = require('./submission-sanitizer');
const {
  getCanonicalRedirectTarget,
  getConfiguredBaseUrl,
} = require('./canonical-url-utils');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const app = express();
app.use((req, res, next) => {
  const redirectTarget = getCanonicalRedirectTarget({
    method: req.method,
    host: req.headers['x-forwarded-host'] || req.headers.host,
    originalUrl: req.originalUrl || req.url,
    configuredBase: getConfiguredBaseUrl(),
  });
  if (redirectTarget) {
    return res.redirect(308, redirectTarget);
  }
  return next();
});
app.use(express.static(__dirname));
app.use(express.json({ limit: '10mb' }))

const SUPABASE_SERVER_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_BROWSER_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_PUBLIC_KEY;

const SERVER_CLIENT_AUTH_OPTIONS = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

// Supabase admin client (secret/service role — server only).
const supabase = createClient(
  process.env.SUPABASE_URL,
  SUPABASE_SERVER_KEY,
  SERVER_CLIENT_AUTH_OPTIONS
);

// User-auth client for user session operations. Keep this separate so sign-in
// and refresh calls cannot pollute the admin client's Authorization context.
const supabaseUserAuth = createClient(
  process.env.SUPABASE_URL,
  SUPABASE_BROWSER_KEY,
  SERVER_CLIENT_AUTH_OPTIONS
);

if (!SUPABASE_SERVER_KEY) {
  console.error(
    '[STARTUP ERROR] SUPABASE_SERVICE_ROLE_KEY is not set. ' +
    'The server will use anonymous Supabase access, which is blocked by RLS for write operations. ' +
    'Set SUPABASE_SERVICE_ROLE_KEY in your environment variables (.env or hosting platform).'
  );
}

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const NOTIFY_FROM_EMAIL =
  process.env.NOTIFY_FROM_EMAIL ||
  process.env.RESEND_FROM_EMAIL ||
  process.env.FROM_EMAIL ||
  '';
const DEADLINE_REMINDER_POLL_MS = Math.max(5 * 60 * 1000, Number(process.env.ASSIGNMENT_REMINDER_POLL_MS || 15 * 60 * 1000));
const DEADLINE_REMINDER_WINDOW_MS = Math.max(5 * 60 * 1000, Number(process.env.ASSIGNMENT_REMINDER_WINDOW_MS || 20 * 60 * 1000));
let deadlineReminderJob = null;
let deadlineReminderInFlight = false;
const ACCOUNT_SETUP_INCOMPLETE_MESSAGE = "Your login worked, but your account setup is incomplete. Please ask your teacher (if you're a student) or contact support so we can finish setting up your account.";
const SIGNUP_PROFILE_ERROR_MESSAGE = "We couldn't finish setting up your account. Please try creating your account again. If this keeps happening, ask your teacher (if you're a student) or contact support.";

if (!process.env.SUPABASE_URL || !SUPABASE_SERVER_KEY) {
  console.warn('Supabase server client is missing SUPABASE_URL or a service-role key.');
}

if (!process.env.SUPABASE_URL || !SUPABASE_BROWSER_KEY) {
  console.warn('Supabase user-auth client is missing SUPABASE_URL or a publishable/anon key.');
}

function getBearerToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

function getRequestScopedSupabase(req) {
  const token = getBearerToken(req);
  if (!process.env.SUPABASE_URL || !SUPABASE_BROWSER_KEY || !token) {
    return supabase;
  }
  return createClient(process.env.SUPABASE_URL, SUPABASE_BROWSER_KEY, {
    ...SERVER_CLIENT_AUTH_OPTIONS,
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

// Helper to get authenticated user from request
async function getUser(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  const { data: { user }, error } = await supabaseUserAuth.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// Helper to get user profile including role
async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) return null;
  return data;
}

function getRequestBaseUrl(req) {
  const configuredBase =
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.SITE_URL ||
    process.env.PUBLIC_SITE_URL;
  if (configuredBase) {
    return String(configuredBase).replace(/\/+$/, '');
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const originHeader = String(req.headers.origin || '').trim();

  if (originHeader) {
    return originHeader.replace(/\/+$/, '');
  }
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`.replace(/\/+$/, '');
  }

  const host = req.headers.host;
  if (host) {
    return `${req.protocol || 'https'}://${host}`.replace(/\/+$/, '');
  }

  return 'http://localhost:3000';
}

function getConfiguredPublicBaseUrl() {
  const configuredBase =
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.SITE_URL ||
    process.env.PUBLIC_SITE_URL ||
    '';
  return String(configuredBase || '').replace(/\/+$/, '');
}

function isLocalhostUrl(value) {
  return /(^https?:\/\/)?(localhost|127\.0\.0\.1|\[?::1\]?)(?::\d+)?/i.test(String(value || '').trim());
}

function getPasswordResetBaseUrl(req, requestedRedirect) {
  const redirectFromClient = String(requestedRedirect || '').trim();
  if (/^https?:\/\//i.test(redirectFromClient) && !isLocalhostUrl(redirectFromClient)) {
    return redirectFromClient.replace(/\/+$/, '');
  }

  const configuredBase = getConfiguredPublicBaseUrl();
  if (configuredBase && !isLocalhostUrl(configuredBase)) {
    return configuredBase;
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  if (forwardedProto && forwardedHost && !isLocalhostUrl(forwardedHost)) {
    return `${forwardedProto}://${forwardedHost}`.replace(/\/+$/, '');
  }

  const originHeader = String(req.headers.origin || '').trim();
  if (originHeader && !isLocalhostUrl(originHeader)) {
    return originHeader.replace(/\/+$/, '');
  }

  return getRequestBaseUrl(req);
}

function canSendNotificationEmails() {
  return Boolean(RESEND_API_KEY && NOTIFY_FROM_EMAIL);
}

function maskEmail(email = '') {
  const value = String(email || '').trim();
  const [name, domain] = value.split('@');
  if (!name || !domain) return value ? 'configured' : '';
  const visibleName = name.length <= 2 ? `${name[0] || ''}*` : `${name.slice(0, 2)}***${name.slice(-1)}`;
  return `${visibleName}@${domain}`;
}

function validatePasswordStrength(password) {
  const value = String(password || '');
  if (value.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (!/\d/.test(value)) {
    return 'Password must include at least 1 number.';
  }
  return '';
}

function makeIdempotencyKey(parts = []) {
  return parts
    .filter(Boolean)
    .join('-')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 240);
}

function clampNumber(value, { min = 0, max = 1, fallback = null } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function escapeHtmlEmail(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDeadline(deadlineValue) {
  if (!deadlineValue) return '';
  const date = new Date(deadlineValue);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  if (!canSendNotificationEmails() || !to) {
    console.warn(`Email skipped for "${subject || 'untitled email'}": ${to ? 'email configuration missing' : 'recipient missing'}`);
    return { skipped: true };
  }
  const recipients = Array.isArray(to) ? to : [to];
  console.info('[EMAIL DIAG] Sending email', {
    subject,
    recipients: recipients.map(maskEmail),
    recipientCount: recipients.length,
    idempotencyKey: idempotencyKey || null,
    hasResendApiKey: Boolean(RESEND_API_KEY),
    hasFromEmail: Boolean(NOTIFY_FROM_EMAIL),
    from: maskEmail(NOTIFY_FROM_EMAIL),
  });
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: NOTIFY_FROM_EMAIL,
      to: recipients,
      subject,
      html,
      text,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('[EMAIL DIAG] Resend rejected email', {
      subject,
      status: response.status,
      payload,
      recipients: recipients.map(maskEmail),
    });
    throw new Error(payload?.message || payload?.error || `Email send failed with status ${response.status}`);
  }
  const recipientCount = recipients.length;
  console.info(`Email sent for "${subject}" to ${recipientCount} recipient${recipientCount === 1 ? "" : "s"}.`, {
    resendId: payload?.id || null,
    recipients: recipients.map(maskEmail),
  });
  return payload;
}

async function waitForNotifications(label, promises = []) {
  const results = await Promise.allSettled(promises.filter(Boolean));
  results.forEach((result) => {
    if (result.status === 'rejected') {
      console.error(`${label} failed:`, result.reason?.message || result.reason);
    }
  });
  return results;
}

async function getAuthUserEmailMap(userIds = []) {
  const wantedIds = Array.from(new Set(userIds.filter(Boolean)));
  const emailMap = new Map();
  if (!wantedIds.length) return emailMap;

  await Promise.all(wantedIds.map(async (userId) => {
    try {
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (error) throw error;
      if (data?.user?.email) {
        emailMap.set(userId, data.user.email);
      }
    } catch (error) {
      console.error(`Could not load auth email for user ${userId}:`, error.message || error);
    }
  }));

  return emailMap;
}

function buildEmailConfigDiagnostic() {
  return {
    emailEnabled: canSendNotificationEmails(),
    hasResendApiKey: Boolean(RESEND_API_KEY),
    hasFromEmail: Boolean(NOTIFY_FROM_EMAIL),
    from: maskEmail(NOTIFY_FROM_EMAIL),
    publicBaseUrl: getConfiguredPublicBaseUrl(),
  };
}

async function getClassStudentRecipients(classId) {
  const { data, error } = await supabase
    .from('class_members')
    .select('student_id, profiles(name)')
    .eq('class_id', classId);
  if (error) throw error;

  const studentRows = (data || []).filter((entry) => entry.student_id);
  const emailMap = await getAuthUserEmailMap(studentRows.map((entry) => entry.student_id));
  return studentRows
    .map((entry) => ({
      id: entry.student_id,
      name: entry.profiles?.name || 'Student',
      email: emailMap.get(entry.student_id) || '',
    }))
    .filter((entry) => entry.email);
}

async function notifyStudentsAboutAssignment({
  assignment,
  className,
  baseUrl,
  mode,
}) {
  if (!canSendNotificationEmails() || !assignment?.class_id) return;
  const recipients = await getClassStudentRecipients(assignment.class_id);
  if (!recipients.length) return;

  const safeTitle = escapeHtmlEmail(assignment.title || 'New assignment');
  const safeClassName = escapeHtmlEmail(className || 'your class');
  const safeDeadline = formatDeadline(assignment.deadline);
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/+$/, '');
  const safeBaseUrl = normalizedBaseUrl ? `${normalizedBaseUrl}/` : '';
  const subject = mode === 'deadline-reminder'
    ? 'Assignment due soon'
    : 'New assignment posted';

  await Promise.allSettled(recipients.map((recipient) => {
    const intro = mode === 'deadline-reminder'
      ? `<p>Hi ${escapeHtmlEmail(recipient.name)},</p><p>This is a reminder that an assignment is due in about 24 hours.</p>`
      : `<p>Hi ${escapeHtmlEmail(recipient.name)},</p><p>Your teacher has posted a new assignment.</p>`;
    const deadlineLine = safeDeadline
      ? `<p><strong>Deadline:</strong> ${escapeHtmlEmail(safeDeadline)}</p>`
      : '';
    const buttonHtml = safeBaseUrl
      ? `<p><a href="${escapeHtmlEmail(safeBaseUrl)}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#4c6fe7;color:#ffffff;text-decoration:none;font-weight:600;">Open praxis</a></p>`
      : '';
    const textDeadlineLine = safeDeadline ? `Deadline: ${safeDeadline}\n` : '';
    const accessLine = safeBaseUrl
      ? `Open praxis here: ${safeBaseUrl}`
      : `Open praxis from your usual class link to view the assignment.`;
    const text = mode === 'deadline-reminder'
      ? `Hi ${recipient.name},\n\nThis is a reminder that an assignment is due in about 24 hours.\nClass: ${className || 'praxis'}\nAssignment: ${assignment.title || 'Assignment'}\n${textDeadlineLine}\n${accessLine}`
      : `Hi ${recipient.name},\n\nYour teacher has posted a new assignment.\nClass: ${className || 'praxis'}\nAssignment: ${assignment.title || 'Assignment'}\n${textDeadlineLine}\n${accessLine}`;

    return sendEmail({
      to: recipient.email,
      subject,
      html: `
        <div style="font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1.6;color:#1d2a44;">
          ${intro}
          <p><strong>Class:</strong> ${safeClassName}</p>
          <p><strong>Assignment:</strong> ${safeTitle}</p>
          ${deadlineLine}
          ${buttonHtml}
        </div>
      `,
      text,
      idempotencyKey: makeIdempotencyKey([
        mode,
        assignment.id,
        recipient.id,
        mode === 'deadline-reminder'
          ? assignment.deadline
          : assignment.updated_at || assignment.created_at || assignment.deadline || 'published',
      ]),
    });
  }));
}

async function notifyStudentAboutGradedSubmission({
  assignment,
  submission,
  previousTeacherReview,
  baseUrl,
}) {
  const shouldSend = teacherReviewWasNewlySaved(previousTeacherReview, submission?.teacher_review);
  if (!canSendNotificationEmails() || !assignment?.id || !submission?.student_id || !shouldSend) {
    console.info('[EMAIL DIAG] Grade notification skipped', {
      emailEnabled: canSendNotificationEmails(),
      assignmentId: assignment?.id || null,
      studentId: submission?.student_id || null,
      shouldSend,
      previousSavedAt: getTeacherReviewSavedAt(previousTeacherReview),
      nextSavedAt: getTeacherReviewSavedAt(submission?.teacher_review),
      nextReviewStatus: submission?.teacher_review?.status || null,
    });
    return;
  }

  const emailMap = await getAuthUserEmailMap([submission.student_id]);
  const studentEmail = emailMap.get(submission.student_id);
  if (!studentEmail) {
    console.error(`Grade notification skipped: no auth email found for student ${submission.student_id}`);
    return;
  }

  const studentName = submission.profiles?.name || 'Student';
  const safeStudentName = escapeHtmlEmail(studentName);
  const safeTitle = escapeHtmlEmail(assignment.title || 'Assignment');
  const safeClassName = escapeHtmlEmail(assignment.classes?.name || assignment.className || 'your class');
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/+$/, '');
  const safeBaseUrl = normalizedBaseUrl ? `${normalizedBaseUrl}/` : '';
  const score = submission.teacher_review?.finalScore;
  const scoreLine = score !== undefined && score !== null && String(score) !== ''
    ? `<p><strong>Score:</strong> ${escapeHtmlEmail(String(score))}</p>`
    : '';
  const textScoreLine = score !== undefined && score !== null && String(score) !== ''
    ? `Score: ${score}\n`
    : '';
  const accessLine = safeBaseUrl
    ? `Open praxis here: ${safeBaseUrl}`
    : `Open praxis from your usual class link to view the feedback.`;
  const buttonHtml = safeBaseUrl
    ? `<p><a href="${escapeHtmlEmail(safeBaseUrl)}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#4c6fe7;color:#ffffff;text-decoration:none;font-weight:600;">View feedback</a></p>`
    : '';

  await sendEmail({
    to: studentEmail,
    subject: 'Feedback ready',
    html: `
      <div style="font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1.6;color:#1d2a44;">
        <p>Hi ${safeStudentName},</p>
        <p>Your teacher has reviewed your work.</p>
        <p><strong>Class:</strong> ${safeClassName}</p>
        <p><strong>Assignment:</strong> ${safeTitle}</p>
        ${scoreLine}
        ${buttonHtml}
      </div>
    `,
    text: `Hi ${studentName},\n\nYour teacher has reviewed your work.\nClass: ${assignment.classes?.name || assignment.className || 'your class'}\nAssignment: ${assignment.title || 'Assignment'}\n${textScoreLine}\n${accessLine}`,
    idempotencyKey: makeIdempotencyKey([
      'grade-published',
      assignment.id,
      submission.student_id,
      getTeacherReviewSavedAt(submission.teacher_review),
    ]),
  });
}

async function notifyStudentAboutReopenedSubmission({
  assignment,
  previousSubmission,
  submission,
  baseUrl,
}) {
  const shouldSend = submissionWasReopened(previousSubmission, submission);
  if (!canSendNotificationEmails() || !assignment?.id || !submission?.student_id || !shouldSend) {
    console.info('[EMAIL DIAG] Reopen notification skipped', {
      emailEnabled: canSendNotificationEmails(),
      assignmentId: assignment?.id || null,
      studentId: submission?.student_id || null,
      shouldSend,
      previousStatus: previousSubmission?.status || null,
      nextStatus: submission?.status || null,
    });
    return;
  }

  const emailMap = await getAuthUserEmailMap([submission.student_id]);
  const studentEmail = emailMap.get(submission.student_id);
  if (!studentEmail) {
    console.error(`Reopen notification skipped: no auth email found for student ${submission.student_id}`);
    return;
  }

  const studentName = submission.profiles?.name || 'Student';
  const safeStudentName = escapeHtmlEmail(studentName);
  const safeTitle = escapeHtmlEmail(assignment.title || 'Assignment');
  const safeClassName = escapeHtmlEmail(assignment.classes?.name || assignment.className || 'your class');
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/+$/, '');
  const safeBaseUrl = normalizedBaseUrl ? `${normalizedBaseUrl}/` : '';
  const buttonHtml = safeBaseUrl
    ? `<p><a href="${escapeHtmlEmail(safeBaseUrl)}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#4c6fe7;color:#ffffff;text-decoration:none;font-weight:600;">Open assignment</a></p>`
    : '';
  const accessLine = safeBaseUrl
    ? `Open praxis here: ${safeBaseUrl}`
    : `Open praxis from your usual class link to edit and resubmit.`;

  await sendEmail({
    to: studentEmail,
    subject: 'Assignment reopened',
    html: `
      <div style="font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1.6;color:#1d2a44;">
        <p>Hi ${safeStudentName},</p>
        <p>Your teacher has reopened an assignment.</p>
        <p><strong>Class:</strong> ${safeClassName}</p>
        <p><strong>Assignment:</strong> ${safeTitle}</p>
        <p>You can edit your work and submit it again. Your existing work is still saved.</p>
        ${buttonHtml}
      </div>
    `,
    text: `Hi ${studentName},\n\nYour teacher has reopened an assignment.\nClass: ${assignment.classes?.name || assignment.className || 'your class'}\nAssignment: ${assignment.title || 'Assignment'}\nYou can edit your work and submit it again. Your existing work is still saved.\n\n${accessLine}`,
    idempotencyKey: makeIdempotencyKey([
      'submission-reopened',
      assignment.id,
      submission.student_id,
      submission.updated_at || submission.updatedAt || new Date().toISOString(),
    ]),
  });
}

async function notifyTeacherAboutStudentSubmission({
  assignment,
  submission,
  baseUrl,
}) {
  if (!canSendNotificationEmails() || !assignment?.class_id || !submission?.student_id) {
    console.info('[EMAIL DIAG] Teacher submission notification skipped', {
      emailEnabled: canSendNotificationEmails(),
      assignmentId: assignment?.id || null,
      classId: assignment?.class_id || null,
      studentId: submission?.student_id || null,
    });
    return;
  }

  const { data: classRow, error: classError } = await supabase
    .from('classes')
    .select('id, name, teacher_id')
    .eq('id', assignment.class_id)
    .maybeSingle();
  if (classError) throw classError;
  if (!classRow?.teacher_id) return;

  const emailMap = await getAuthUserEmailMap([classRow.teacher_id]);
  const teacherEmail = emailMap.get(classRow.teacher_id);
  if (!teacherEmail) {
    console.error(`Submission notification skipped: no auth email found for teacher ${classRow.teacher_id}`);
    return;
  }

  const studentName = submission.profiles?.name || 'A student';
  const safeStudentName = escapeHtmlEmail(studentName);
  const safeTitle = escapeHtmlEmail(assignment.title || 'Assignment');
  const safeClassName = escapeHtmlEmail(classRow.name || 'your class');
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/+$/, '');
  const safeBaseUrl = normalizedBaseUrl ? `${normalizedBaseUrl}/` : '';
  const submittedAt = formatDeadline(submission.submitted_at || submission.submittedAt || new Date().toISOString());
  const submittedLine = submittedAt
    ? `<p><strong>Submitted:</strong> ${escapeHtmlEmail(submittedAt)}</p>`
    : '';
  const textSubmittedLine = submittedAt ? `Submitted: ${submittedAt}\n` : '';
  const buttonHtml = safeBaseUrl
    ? `<p><a href="${escapeHtmlEmail(safeBaseUrl)}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#4c6fe7;color:#ffffff;text-decoration:none;font-weight:600;">Open teacher dashboard</a></p>`
    : '';
  const accessLine = safeBaseUrl
    ? `Open praxis here: ${safeBaseUrl}`
    : `Open praxis from your usual teacher link to review the submission.`;

  await sendEmail({
    to: teacherEmail,
    subject: 'New assignment submission',
    html: `
      <div style="font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1.6;color:#1d2a44;">
        <p>A student has submitted work for review.</p>
        <p><strong>Student:</strong> ${safeStudentName}</p>
        <p><strong>Class:</strong> ${safeClassName}</p>
        <p><strong>Assignment:</strong> ${safeTitle}</p>
        ${submittedLine}
        ${buttonHtml}
      </div>
    `,
    text: `A student has submitted work for review.\nStudent: ${studentName}\nClass: ${classRow.name || 'your class'}\nAssignment: ${assignment.title || 'Assignment'}\n${textSubmittedLine}\n${accessLine}`,
    idempotencyKey: makeIdempotencyKey([
      'student-submitted',
      assignment.id,
      submission.student_id,
      submission.submitted_at || submission.submittedAt || submission.updated_at || submission.updatedAt || new Date().toISOString(),
    ]),
  });
}

async function processUpcomingDeadlineReminders() {
  if (!canSendNotificationEmails() || deadlineReminderInFlight) return;
  deadlineReminderInFlight = true;
  try {
    const now = Date.now();
    const lowerBound = new Date(now + (24 * 60 * 60 * 1000) - DEADLINE_REMINDER_WINDOW_MS).toISOString();
    const upperBound = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    const { data: assignments, error } = await supabase
      .from('assignments')
      .select('id, class_id, title, deadline, status')
      .eq('status', 'published')
      .gte('deadline', lowerBound)
      .lte('deadline', upperBound);
    if (error) throw error;
    if (!assignments?.length) return;

    const classIds = Array.from(new Set(assignments.map((assignment) => assignment.class_id).filter(Boolean)));
    const { data: classRows, error: classError } = await supabase
      .from('classes')
      .select('id, name')
      .in('id', classIds);
    if (classError) throw classError;
    const classNameMap = new Map((classRows || []).map((row) => [row.id, row.name]));

    for (const assignment of assignments) {
      await notifyStudentsAboutAssignment({
        assignment,
        className: classNameMap.get(assignment.class_id) || 'your class',
        baseUrl: getConfiguredPublicBaseUrl(),
        mode: 'deadline-reminder',
      });
    }
  } catch (error) {
    console.error('Deadline reminder processing failed:', error);
  } finally {
    deadlineReminderInFlight = false;
  }
}

async function requireTeacherProfile(req) {
  const user = await getUser(req);
  if (!user) return { user: null, profile: null, error: 'Not authenticated', status: 401 };
  const profile = await getProfile(user.id);
  if (!profile) {
    return { user, profile: null, error: ACCOUNT_SETUP_INCOMPLETE_MESSAGE, status: 409 };
  }
  if (profile.role !== 'teacher' && profile.role !== 'admin') {
    return { user, profile, error: 'Teacher access required', status: 403 };
  }
  return { user, profile, error: null, status: 200 };
}

async function ensureTeacherOwnsClass(classId, teacherId, client = supabase) {
  const { data, error } = await client
    .from('classes')
    .select('id, teacher_id, name')
    .eq('id', classId)
    .eq('teacher_id', teacherId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function ensureTeacherOwnsAssignment(assignmentId, teacherId, client = supabase) {
  const { data, error } = await client
    .from('assignments')
    .select('id, class_id, title, status')
    .eq('id', assignmentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const ownedClass = await ensureTeacherOwnsClass(data.class_id, teacherId, client);
  return ownedClass ? { ...data, className: ownedClass.name || '' } : null;
}

async function ensureStudentBelongsToClass(classId, studentId, client = supabase) {
  const { data, error } = await client
    .from('class_members')
    .select('class_id')
    .eq('class_id', classId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function ensureUserCanAccessClass(classId, userId, client = supabase) {
  const ownedClass = await ensureTeacherOwnsClass(classId, userId, client);
  if (ownedClass) return { role: 'teacher', classRecord: ownedClass };
  const enrolledClass = await ensureStudentBelongsToClass(classId, userId, client);
  if (enrolledClass) return { role: 'student', classRecord: enrolledClass };
  return null;
}

async function ensureStudentCanAccessAssignment(assignmentId, studentId, client = supabase) {
  const { data, error } = await client
    .from('assignments')
    .select('id, class_id, title, status')
    .eq('id', assignmentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.status !== 'published') return null;
  const enrolledClass = await ensureStudentBelongsToClass(data.class_id, studentId, client);
  return enrolledClass ? data : null;
}

async function getSubmissionRecord(submissionId, client = supabase) {
  const { data, error } = await client
    .from('submissions')
    .select('id, assignment_id, student_id, status, teacher_review')
    .eq('id', submissionId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function getSubmissionTeacherReview(submission = {}) {
  return submission.teacher_review || submission.teacherReview || {};
}

function getSubmissionProcessInputHash(submission = {}, assignment = {}, profile = {}) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      submissionId: submission.id,
      assignmentId: submission.assignment_id || submission.assignmentId,
      studentId: submission.student_id || submission.studentId,
      finalText: submission.final_text || submission.finalText || '',
      draftText: submission.draft_text || submission.draftText || '',
      writingEvents: submission.writing_events || submission.writingEvents || [],
      keystrokeLog: submission.keystroke_log || submission.keystrokeLog || [],
      teacherReview: getSubmissionTeacherReview(submission),
      assignmentStatus: assignment.status || '',
      assignmentLevel: assignment.language_level || assignment.languageLevel || '',
      profileFlags: {
        isTestAccount: Boolean(profile.is_test_account || profile.isTestAccount),
      },
      updatedAt: submission.updated_at || submission.updatedAt || '',
    }))
    .digest('hex');
}

function getProcessAnalysisExclusionSources(submission = {}, profile = {}) {
  const sources = [];
  const review = getSubmissionTeacherReview(submission);
  if (profile?.is_test_account || profile?.isTestAccount) sources.push('test_account');
  if (review?.writingBehaviourExcluded || review?.writing_behaviour_excluded) sources.push('submission_flag');
  return sources;
}

function buildProcessAnalysisPayload({ submission, assignment, profile, analysis, inputHash }) {
  return {
    submission_id: submission.id,
    assignment_id: submission.assignment_id || submission.assignmentId,
    class_id: assignment.class_id || assignment.classId || null,
    student_id: submission.student_id || submission.studentId,
    analysis_version: analysis.analysisVersion,
    input_hash: inputHash,
    process_status: analysis.status,
    process_status_label: analysis.statusLabel,
    reason: analysis.reason || '',
    metrics: analysis.metrics || {},
    timeline: analysis.timeline || [],
    evidence: analysis.evidence || [],
    paste_evidence: analysis.pasteEvidence || [],
    cohort_comparison: analysis.cohortComparison || {},
    coach_baseline: analysis.coachBaseline || {},
    excluded_from_analytics: Boolean(analysis.excludedFromAnalytics),
    exclusion_sources: analysis.exclusionSources || getProcessAnalysisExclusionSources(submission, profile),
    calculated_at: analysis.calculatedAt,
    updated_at: new Date().toISOString(),
  };
}

async function getProcessAnalysisContext(req, submissionId) {
  const user = await getUser(req);
  if (!user) return { status: 401, error: 'Not authenticated' };
  const viewerProfile = await getProfile(user.id);
  if (!viewerProfile) return { status: 409, error: ACCOUNT_SETUP_INCOMPLETE_MESSAGE };

  const readClient = getRequestScopedSupabase(req);
  const { data: submission, error: submissionError } = await readClient
    .from('submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle();
  if (submissionError) return { status: 400, error: submissionError.message };
  if (!submission) return { status: 404, error: 'Submission not found' };

  const { data: assignment, error: assignmentError } = await readClient
    .from('assignments')
    .select('*')
    .eq('id', submission.assignment_id)
    .maybeSingle();
  if (assignmentError) return { status: 400, error: assignmentError.message };
  if (!assignment) return { status: 404, error: 'Assignment not found' };

  let allowed = false;
  if (viewerProfile.role === 'admin') {
    allowed = true;
  } else if (viewerProfile.role === 'student') {
    allowed = submission.student_id === user.id;
  } else if (viewerProfile.role === 'teacher') {
    const ownedAssignment = await ensureTeacherOwnsAssignment(assignment.id, user.id, readClient);
    allowed = Boolean(ownedAssignment);
  }
  if (!allowed) return { status: 403, error: 'You do not have access to this writing process analysis.' };

  const { data: studentProfile } = await supabase
    .from('profiles')
    .select('id, name, role, is_test_account')
    .eq('id', submission.student_id)
    .maybeSingle();

  return {
    status: 200,
    user,
    viewerProfile,
    submission,
    assignment,
    studentProfile: studentProfile || {},
  };
}

async function computeAndStoreProcessAnalysis(context, { store = true } = {}) {
  const exclusionSources = getProcessAnalysisExclusionSources(context.submission, context.studentProfile);
  const analysis = analyzeSubmission(context.submission, context.assignment, {
    excludedFromAnalytics: exclusionSources.length > 0,
    exclusionSources,
  });
  const inputHash = getSubmissionProcessInputHash(context.submission, context.assignment, context.studentProfile);
  const payload = buildProcessAnalysisPayload({
    submission: context.submission,
    assignment: context.assignment,
    profile: context.studentProfile,
    analysis,
    inputHash,
  });

  if (!store) return { analysis, inputHash, stored: null, storageError: null };

  const { data, error } = await supabase
    .from('submission_process_analyses')
    .upsert(payload, { onConflict: 'submission_id' })
    .select()
    .single();

  return {
    analysis,
    inputHash,
    stored: data || null,
    storageError: error ? error.message : null,
  };
}

// ── Rubric parsing endpoints ────────────────────────────────
app.post('/api/rubric/parse', upload.single('rubric'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

    const { text, schema, rubricData } = await parseRubricBuffer(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );

    res.json({
      success: true,
      text,
      schema,
      rubricData,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/extract-rubric', upload.single('rubric'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { text, schema, rubricData } = await parseRubricBuffer(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );

    res.json({ text, schema, rubricData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rubric/parse-text', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ success: false, error: 'Text is required' });

    const parsed = await parseRubricText(text, 'Pasted rubric');
    res.json({
      success: true,
      text: parsed.text,
      schema: parsed.schema,
      rubricData: parsed.rubricData,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── AI endpoint ─────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, messages, system, maxTokens, temperature } = req.body;
    const apiMessages = (messages || [{ role: "user", content: prompt }])
      .map(({ role, content }) => ({ role, content }));
    const requestBody = {
      model: "claude-sonnet-4-6",
      max_tokens: clampNumber(maxTokens, { min: 200, max: 2500, fallback: 1000 }),
      messages: apiMessages,
    };
    if (system) requestBody.system = system;
    const safeTemperature = clampNumber(temperature, { min: 0, max: 1, fallback: null });
    if (safeTemperature !== null) requestBody.temperature = safeTemperature;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error.message });
    res.json({ response: data.content[0].text });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Auth endpoints ───────────────────────────────────────────

// Sign up
app.post('/api/auth/signup', async (req, res) => {
  let createdUserId = null;
  let createdUserEmail = null;
  try {
    const { email, password, name, role } = req.body;
    if (!email || !password || !name || !role) {
      return res.status(400).json({ error: 'email, password, name and role are required' });
    }
    if (!['student', 'teacher'].includes(role)) {
      return res.status(400).json({ error: 'Please choose student or teacher.' });
    }
    const passwordError = validatePasswordStrength(password);
    if (passwordError) return res.status(400).json({ error: passwordError });
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name, role },
      email_confirm: true,
    });
    if (error) return res.status(400).json({ error: error.message });
    createdUserId = data?.user?.id || null;
    createdUserEmail = data?.user?.email || email;
    if (!createdUserId) {
      return res.status(500).json({ error: SIGNUP_PROFILE_ERROR_MESSAGE });
    }

    // Create profile manually instead of relying on a database trigger.
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: createdUserId,
        name,
        role,
      })
      .select()
      .single();
    if (profileError || !profile) {
      const { error: deleteError } = await supabase.auth.admin.deleteUser(createdUserId);
      if (deleteError) {
        console.error('ORPHAN AUTH USER - manual cleanup needed:', createdUserId, createdUserEmail, deleteError.message);
      }
      return res.status(500).json({ error: SIGNUP_PROFILE_ERROR_MESSAGE });
    }

    return res.status(201).json({ profile });
  } catch (error) {
    if (createdUserId) {
      try {
        const { error: deleteError } = await supabase.auth.admin.deleteUser(createdUserId);
        if (deleteError) {
          console.error('ORPHAN AUTH USER - manual cleanup needed:', createdUserId, createdUserEmail || req.body?.email, deleteError.message);
        }
      } catch (deleteError) {
        console.error('ORPHAN AUTH USER - manual cleanup needed:', createdUserId, createdUserEmail || req.body?.email, deleteError.message);
      }
    }
    res.status(500).json({ error: createdUserId ? SIGNUP_PROFILE_ERROR_MESSAGE : error.message });
  }
});

// Sign in
app.post('/api/auth/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabaseUserAuth.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: error.message });
    const profile = await getProfile(data.user.id);
    if (!profile) return res.status(409).json({ error: ACCOUNT_SETUP_INCOMPLETE_MESSAGE });
    res.json({ session: data.session, profile });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Refresh expired Supabase session
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token required' });

    const { data, error } = await supabaseUserAuth.auth.refreshSession({ refresh_token });
    if (error) return res.status(401).json({ error: error.message });

    res.json({ session: data.session });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sign out
app.post('/api/auth/signout', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (auth) await supabase.auth.admin.signOut(auth.slice(7));
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email, redirectTo: requestedRedirect } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const redirectTo = appendResetQuery(getPasswordResetBaseUrl(req, requestedRedirect));
    const { error } = await supabaseUserAuth.auth.resetPasswordForEmail(String(email).trim(), {
      redirectTo,
    });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true, redirectTo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/update-password', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const password = String(req.body?.password || '');
    const passwordError = validatePasswordStrength(password);
    if (passwordError) return res.status(400).json({ error: passwordError });
    const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/notifications/status', async (req, res) => {
  try {
    const { error, status } = await requireTeacherProfile(req);
    if (error) return res.status(status).json({ error });
    res.json({
      emailEnabled: canSendNotificationEmails(),
      hasResendApiKey: Boolean(RESEND_API_KEY),
      hasFromEmail: Boolean(NOTIFY_FROM_EMAIL),
      publicBaseUrl: getConfiguredPublicBaseUrl(),
      forgotPasswordRedirectTo: appendResetQuery(getPasswordResetBaseUrl(req, req.query?.redirectTo)),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/notifications/test', async (req, res) => {
  try {
    const { user, error, status } = await requireTeacherProfile(req);
    if (error) return res.status(status).json({ error });
    if (!canSendNotificationEmails()) {
      return res.status(400).json({ error: 'Email notifications are disabled. Set RESEND_API_KEY and NOTIFY_FROM_EMAIL.' });
    }
    if (!user.email) return res.status(400).json({ error: 'Your account has no email address to test.' });
    const result = await sendEmail({
      to: user.email,
      subject: 'praxis email test',
      html: '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1.6;color:#1d2a44;"><p>This is a praxis email test. If you received this, notification email delivery is configured.</p></div>',
      text: 'This is a praxis email test. If you received this, notification email delivery is configured.',
      idempotencyKey: makeIdempotencyKey(['notification-test', user.id, new Date().toISOString()]),
    });
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/notifications/diagnose-submission', async (req, res) => {
  try {
    const { user, error, status } = await requireTeacherProfile(req);
    if (error) return res.status(status).json({ error });

    const assignmentId = String(req.query.assignmentId || '').trim();
    const studentId = String(req.query.studentId || '').trim();
    if (!assignmentId || !studentId) {
      return res.status(400).json({ error: 'assignmentId and studentId are required.' });
    }

    const readClient = getRequestScopedSupabase(req);
    const assignment = await ensureTeacherOwnsAssignment(assignmentId, user.id, readClient);
    if (!assignment) return res.status(403).json({ error: 'You can only diagnose your own assignments.' });

    const { data: classRow, error: classError } = await supabase
      .from('classes')
      .select('id, name, teacher_id')
      .eq('id', assignment.class_id)
      .maybeSingle();
    if (classError) return res.status(400).json({ error: classError.message });

    const { data: submission, error: submissionError } = await supabase
      .from('submissions')
      .select('*, profiles(id, name)')
      .eq('assignment_id', assignmentId)
      .eq('student_id', studentId)
      .maybeSingle();
    if (submissionError) return res.status(400).json({ error: submissionError.message });

    const emailMap = await getAuthUserEmailMap([studentId, classRow?.teacher_id].filter(Boolean));
    const studentEmail = emailMap.get(studentId) || '';
    const teacherEmail = classRow?.teacher_id ? emailMap.get(classRow.teacher_id) || '' : '';
    const review = submission?.teacher_review || {};
    const submittedAt = submission?.submitted_at || submission?.submittedAt || '';
    const gradeSavedAt = getTeacherReviewSavedAt(review);

    const teacherSubmissionKey = makeIdempotencyKey([
      'student-submitted',
      assignment.id,
      studentId,
      submittedAt || submission?.updated_at || new Date().toISOString(),
    ]);
    const gradeKey = makeIdempotencyKey([
      'grade-published',
      assignment.id,
      studentId,
      gradeSavedAt,
    ]);
    const reopenKey = makeIdempotencyKey([
      'submission-reopened',
      assignment.id,
      studentId,
      submission?.updated_at || new Date().toISOString(),
    ]);

    res.json({
      checkedAt: new Date().toISOString(),
      config: buildEmailConfigDiagnostic(),
      assignment: {
        id: assignment.id,
        title: assignment.title,
        status: assignment.status,
        classId: assignment.class_id,
      },
      class: classRow ? {
        id: classRow.id,
        name: classRow.name,
        teacherId: classRow.teacher_id,
      } : null,
      submission: submission ? {
        id: submission.id,
        studentId: submission.student_id,
        studentName: submission.profiles?.name || '',
        status: submission.status,
        submittedAt,
        updatedAt: submission.updated_at,
        teacherReview: {
          status: review.status || null,
          savedAt: gradeSavedAt || null,
          finalScore: review.finalScore ?? review.final_score ?? null,
          finalNotesLength: String(review.finalNotes || review.final_notes || '').length,
        },
      } : null,
      recipients: {
        teacher: {
          id: classRow?.teacher_id || null,
          hasEmail: Boolean(teacherEmail),
          email: maskEmail(teacherEmail),
        },
        student: {
          id: studentId,
          hasEmail: Boolean(studentEmail),
          email: maskEmail(studentEmail),
        },
      },
      decisions: {
        teacherSubmission: {
          wouldAttempt: Boolean(canSendNotificationEmails() && assignment?.class_id && submission?.student_id && teacherEmail),
          idempotencyKey: teacherSubmissionKey,
        },
        studentGrade: {
          wouldAttemptIfPreviousEmpty: Boolean(canSendNotificationEmails() && assignment?.id && submission?.student_id && studentEmail && teacherReviewWasNewlySaved(null, review)),
          wouldAttemptIfPreviousSame: Boolean(canSendNotificationEmails() && assignment?.id && submission?.student_id && studentEmail && teacherReviewWasNewlySaved(review, review)),
          currentReviewWouldTriggerFromEmpty: teacherReviewWasNewlySaved(null, review),
          idempotencyKey: gradeKey,
        },
        studentReopen: {
          wouldAttemptIfPreviousGraded: Boolean(canSendNotificationEmails() && assignment?.id && submission?.student_id && studentEmail && submissionWasReopened({ status: 'graded' }, submission)),
          currentStatusWouldTriggerFromGraded: submissionWasReopened({ status: 'graded' }, submission),
          idempotencyKey: reopenKey,
        },
      },
    });
  } catch (error) {
    console.error('Email notification diagnostic failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get current user profile
app.get('/api/auth/me', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const profile = await getProfile(user.id);
    if (!profile) return res.status(409).json({ error: ACCOUNT_SETUP_INCOMPLETE_MESSAGE });
    res.json({ profile });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Classes endpoints ────────────────────────────────────────

// Get teacher's classes
app.get('/api/classes', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const readClient = getRequestScopedSupabase(req);
    const { data, error } = await readClient
      .from('classes')
      .select('*, class_members(student_id, profiles(id, name))')
      .eq('teacher_id', user.id)
      .order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ classes: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a class
app.post('/api/classes', async (req, res) => {
  try {
    const { user, error: teacherError, status } = await requireTeacherProfile(req);
    if (teacherError) return res.status(status).json({ error: teacherError });
    const { name } = req.body;
    const { data, error } = await writeWithRequestScopedFallback(req, (client) => client
      .from('classes')
      .insert({ name, teacher_id: user.id })
      .select()
      .single());
    if (error) return res.status(400).json({ error: error.message });
    res.json({ class: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add student to class
app.post('/api/classes/:classId/members', async (req, res) => {
  try {
    const { user, error: teacherError, status } = await requireTeacherProfile(req);
    if (teacherError) return res.status(status).json({ error: teacherError });
    const readClient = getRequestScopedSupabase(req);
    const ownedClass = await ensureTeacherOwnsClass(req.params.classId, user.id, readClient);
    if (!ownedClass) return res.status(403).json({ error: 'You can only add students to your own classes.' });
    const { studentEmail } = req.body;
    // Find student by email
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const authUser = authUsers.users.find(u => u.email === studentEmail);
    if (!authUser) return res.status(404).json({ error: 'No student found with that email' });
    const studentProfile = await getProfile(authUser.id);
    if (!studentProfile || studentProfile.role !== 'student') {
      return res.status(404).json({ error: 'No student found with that email' });
    }
    const { error } = await writeWithRequestScopedFallback(req, (client) => client
      .from('class_members')
      .upsert(
        { class_id: req.params.classId, student_id: authUser.id },
        { onConflict: 'class_id,student_id' }
      ));
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/classes/:classId', async (req, res) => {
  try {
    const { user, error: teacherError, status } = await requireTeacherProfile(req);
    if (teacherError) return res.status(status).json({ error: teacherError });
    const readClient = getRequestScopedSupabase(req);
    const ownedClass = await ensureTeacherOwnsClass(req.params.classId, user.id, readClient);
    if (!ownedClass) return res.status(403).json({ error: 'You can only delete your own classes.' });
    const { data: assignments } = await supabase
      .from('assignments')
      .select('id')
      .eq('class_id', req.params.classId);
    const assignmentIds = (assignments || []).map(a => a.id);
    if (assignmentIds.length) {
      await supabase.from('submissions').delete().in('assignment_id', assignmentIds);
      await supabase.from('assignments').delete().in('id', assignmentIds);
    }
    await supabase.from('class_members').delete().eq('class_id', req.params.classId);
    const { error } = await supabase.from('classes').delete().eq('id', req.params.classId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/classes/:classId/members/:studentId', async (req, res) => {
  try {
    const { user, error: teacherError, status } = await requireTeacherProfile(req);
    if (teacherError) return res.status(status).json({ error: teacherError });
    const readClient = getRequestScopedSupabase(req);
    const ownedClass = await ensureTeacherOwnsClass(req.params.classId, user.id, readClient);
    if (!ownedClass) return res.status(403).json({ error: 'You can only remove students from your own classes.' });
    const { error } = await writeWithRequestScopedFallback(req, (client) => client
      .from('class_members')
      .delete()
      .eq('class_id', req.params.classId)
      .eq('student_id', req.params.studentId));
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/classes/:classId/members/:studentId', async (req, res) => {
  try {
    const { user, error: teacherError, status } = await requireTeacherProfile(req);
    if (teacherError) return res.status(status).json({ error: teacherError });
    const readClient = getRequestScopedSupabase(req);
    const ownedClass = await ensureTeacherOwnsClass(req.params.classId, user.id, readClient);
    if (!ownedClass) return res.status(403).json({ error: 'You can only rename students in your own classes.' });
    const enrolledStudent = await ensureStudentBelongsToClass(req.params.classId, req.params.studentId, readClient);
    if (!enrolledStudent) return res.status(404).json({ error: 'That student is not enrolled in this class.' });

    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'A student name is required.' });

    const { data, error } = await supabase
      .from('profiles')
      .update({ name })
      .eq('id', req.params.studentId)
      .select('id, name, role');
    if (error) return res.status(400).json({ error: error.message });
    const profile = Array.isArray(data) ? data[0] : data;
    if (!profile) return res.status(404).json({ error: 'Student profile not found after rename.' });
    res.json({ profile });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get classes for a student
app.get('/api/student/classes', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const readClient = getRequestScopedSupabase(req);
    const { data, error } = await readClient
      .from('class_members')
      .select('class_id, classes(id, name, teacher_id, profiles(name))')
      .eq('student_id', user.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ classes: data.map(d => d.classes) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Join class via invite token
app.get('/api/classes/:classId/invite', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('classes')
      .select('name, profiles(name)')
      .eq('id', req.params.classId)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Class not found' });
    res.json({
      className: data.name,
      teacherName: data.profiles?.name || "",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auto-join class after signup
app.post('/api/classes/:classId/join', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const profile = await getProfile(user.id);
    if (profile?.role !== 'student') {
      return res.status(403).json({ error: 'Only student accounts can join classes.' });
    }
    const { error } = await writeWithRequestScopedFallback(req, (client) => client
      .from('class_members')
      .insert({ class_id: req.params.classId, student_id: user.id })
      .select('class_id, student_id')
      .single());
    if (error?.code === '23505') {
      return res.json({ ok: true, alreadyJoined: true });
    }
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/classes/:classId/members', async (req, res) => {
  try {
    const { user, error: teacherError, status } = await requireTeacherProfile(req);
    if (teacherError) return res.status(status).json({ error: teacherError });
    const readClient = getRequestScopedSupabase(req);
    const ownedClass = await ensureTeacherOwnsClass(req.params.classId, user.id, readClient);
    if (!ownedClass) return res.status(403).json({ error: 'You can only view rosters for your own classes.' });
    const { data, error } = await readClient
      .from('class_members')
      .select('student_id, profiles(id, name)')
      .eq('class_id', req.params.classId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({
      members: data
        .filter((entry) => entry.student_id !== user.id && entry.profiles)
        .map((entry) => entry.profiles),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Assignments endpoints ────────────────────────────────────

const ASSIGNMENT_ALLOWED_FIELDS = new Set([
  'title',
  'prompt',
  'brief',
  'focus',
  'assignment_type',
  'language_level',
  'word_count_min',
  'word_count_max',
  'idea_request_limit',
  'feedback_request_limit',
  'chat_time_limit',
  'student_focus',
  'rubric',
  'status',
  'deadline',
  'uploaded_rubric_text',
  'class_id',
]);

function sanitizePayload(payload = {}, allowedFields = new Set()) {
  return Object.fromEntries(
    Object.entries(payload || {}).filter(([key, value]) => allowedFields.has(key) && value !== undefined)
  );
}

function sanitizeAssignmentPayload(payload = {}) {
  return sanitizePayload(payload, ASSIGNMENT_ALLOWED_FIELDS);
}

async function assignmentWriteWithFallback(req, writeFn) {
  return writeWithRequestScopedFallback(req, writeFn);
}

async function submissionWriteWithFallback(req, writeFn) {
  return writeWithRequestScopedFallback(req, writeFn);
}

async function writeWithRequestScopedFallback(req, writeFn) {
  const requestScopedSupabase = getRequestScopedSupabase(req);
  const candidates = [];
  if (requestScopedSupabase && requestScopedSupabase !== supabase) {
    candidates.push({ client: requestScopedSupabase, label: 'authenticated session' });
  }
  candidates.push({ client: supabase, label: 'server key' });

  let lastResult = { data: null, error: null, label: '' };
  for (const candidate of candidates) {
    const { data, error } = await writeFn(candidate.client);
    lastResult = { data, error, label: candidate.label };
    if (!error) return lastResult;
    if (!/row-level security policy/i.test(error.message || '')) break;
  }
  return lastResult;
}

async function queryAssignmentsForClass(req, classId, accessRole) {
  const requestScopedSupabase = getRequestScopedSupabase(req);
  const candidates = [];
  if (requestScopedSupabase && requestScopedSupabase !== supabase) {
    candidates.push(requestScopedSupabase);
  }
  candidates.push(supabase);

  let lastError = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const client = candidates[index];
    let query = client
      .from('assignments')
      .select('*')
      .eq('class_id', classId)
      .order('created_at', { ascending: false });
    if (accessRole === 'student') {
      query = query.eq('status', 'published');
    }

    const { data, error } = await query;
    if (error) {
      lastError = error;
      continue;
    }

    if (Array.isArray(data) && data.length > 0) {
      return { data, error: null };
    }

    const isLastCandidate = index === candidates.length - 1;
    if (accessRole !== 'teacher' || isLastCandidate) {
      return { data: data || [], error: null };
    }
  }

  return { data: [], error: lastError };
}

// Get assignments for a class
app.get('/api/classes/:classId/assignments', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const readClient = getRequestScopedSupabase(req);
    const access = await ensureUserCanAccessClass(req.params.classId, user.id, readClient);
    if (!access) return res.status(403).json({ error: 'You do not have access to this class.' });
    const { data, error } = await queryAssignmentsForClass(req, req.params.classId, access.role);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ assignments: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create assignment
app.post('/api/classes/:classId/assignments', async (req, res) => {
  try {
    const { user, error: teacherError, status } = await requireTeacherProfile(req);
    if (teacherError) return res.status(status).json({ error: teacherError });
    const readClient = getRequestScopedSupabase(req);
    const ownedClass = await ensureTeacherOwnsClass(req.params.classId, user.id, readClient);
    if (!ownedClass) return res.status(403).json({ error: 'You can only add assignments to your own classes.' });
    const payload = sanitizeAssignmentPayload(req.body);
    const { data, error, label } = await assignmentWriteWithFallback(req, (client) => client
      .from('assignments')
      .insert({ ...payload, class_id: req.params.classId })
      .select()
      .single());
    if (error) {
      if (/row-level security policy/i.test(error.message || "")) {
        return res.status(400).json({
         error: SUPABASE_SERVER_KEY
            ? 'Assignment save is blocked by Supabase RLS. The teacher session and server key were rejected - check the assignments INSERT policy in your Supabase dashboard.'
            : 'Assignment save failed: SUPABASE_SERVICE_ROLE_KEY is missing from server environment. Add it to your .env file or hosting platform settings.'
        });
      }
      return res.status(400).json({ error: error.message });
    }
    if (label && label !== 'server key') {
      console.info(`Assignment created with ${label} after teacher ownership verification.`);
    }
    res.json({ assignment: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update assignment
app.patch('/api/assignments/:id', async (req, res) => {
  try {
    const { user, error: teacherError, status } = await requireTeacherProfile(req);
    if (teacherError) return res.status(status).json({ error: teacherError });
    const readClient = getRequestScopedSupabase(req);
    const ownedAssignment = await ensureTeacherOwnsAssignment(req.params.id, user.id, readClient);
    if (!ownedAssignment) return res.status(403).json({ error: 'You can only update assignments in your own classes.' });
    const ownedClass = await ensureTeacherOwnsClass(ownedAssignment.class_id, user.id, readClient);
    const payload = sanitizeAssignmentPayload(req.body);
    const { data, error, label } = await assignmentWriteWithFallback(req, (client) => client
      .from('assignments')
      .update(payload)
      .eq('id', req.params.id)
      .select()
      .single());
    if (error) {
      if (/row-level security policy/i.test(error.message || "")) {
        return res.status(400).json({
          error: SUPABASE_SERVER_KEY
            ? 'Assignment update is blocked by Supabase RLS. The teacher session and server key were rejected - check the assignments UPDATE policy in your Supabase dashboard.'
            : 'Assignment update failed: SUPABASE_SERVICE_ROLE_KEY is missing from server environment. Add it to your .env file or hosting platform settings.'
        });
      }
      return res.status(400).json({ error: error.message });
    }
    if (label && label !== 'server key') {
      console.info(`Assignment updated with ${label} after teacher ownership verification.`);
    }
    if (ownedAssignment.status !== 'published' && data?.status === 'published') {
      notifyStudentsAboutAssignment({
        assignment: data,
        className: ownedClass?.name || 'your class',
        baseUrl: getRequestBaseUrl(req),
        mode: 'published',
      }).catch((notifyError) => {
        console.error('Assignment publish email failed:', notifyError);
      });
    }
    res.json({ assignment: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete assignment
app.delete('/api/assignments/:id', async (req, res) => {
  try {
    const { user, error: teacherError, status } = await requireTeacherProfile(req);
    if (teacherError) return res.status(status).json({ error: teacherError });
    const readClient = getRequestScopedSupabase(req);
    const ownedAssignment = await ensureTeacherOwnsAssignment(req.params.id, user.id, readClient);
    if (!ownedAssignment) return res.status(403).json({ error: 'You can only delete assignments in your own classes.' });

    const { error: submissionDeleteError } = await supabase
      .from('submissions')
      .delete()
      .eq('assignment_id', req.params.id);
    if (submissionDeleteError) return res.status(400).json({ error: submissionDeleteError.message });

    const { error } = await supabase
      .from('assignments')
      .delete()
      .eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Submissions endpoints ────────────────────────────────────

// Get all submissions for an assignment (teacher)
app.get('/api/assignments/:assignmentId/submissions', async (req, res) => {
  try {
    const { user, error: teacherError, status } = await requireTeacherProfile(req);
    if (teacherError) return res.status(status).json({ error: teacherError });
    const readClient = getRequestScopedSupabase(req);
    let ownedAssignment = null;
    try {
      ownedAssignment = await ensureTeacherOwnsAssignment(req.params.assignmentId, user.id, readClient);
    } catch (accessError) {
      console.error('Could not verify teacher assignment access:', req.params.assignmentId, user.id, accessError.message);
      return res.status(400).json({ error: 'Could not verify access to this assignment. Please refresh and try again.' });
    }
    if (!ownedAssignment) return res.status(403).json({ error: 'You can only view submissions for your own assignments.' });
    const requestScopedSupabase = getRequestScopedSupabase(req);
    const candidates = [];
    if (requestScopedSupabase && requestScopedSupabase !== supabase) {
      candidates.push(requestScopedSupabase);
    }
    candidates.push(supabase);

    let data = null;
    let lastError = null;
    for (const client of candidates) {
      const result = await client
        .from('submissions')
        .select('*, profiles(id, name)')
        .eq('assignment_id', req.params.assignmentId);
      if (!result.error) {
        data = result.data || [];
        lastError = null;
        break;
      }
      lastError = result.error;
    }
    if (lastError) {
      console.error('Could not load assignment submissions:', req.params.assignmentId, lastError.message);
      return res.status(400).json({ error: 'Could not load submissions for this assignment. Please refresh and try again.' });
    }
    res.json({ submissions: data });
  } catch (error) {
    console.error('Unexpected submissions endpoint failure:', error);
    res.status(500).json({ error: 'Could not load submissions right now. Please refresh and try again.' });
  }
});

// Get the authenticated student's existing submissions without creating new rows
app.get('/api/student/submissions', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const readClient = getRequestScopedSupabase(req);

    const requestedAssignmentIds = String(req.query.assignmentIds || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    const { data: memberships, error: membershipError } = await readClient
      .from('class_members')
      .select('class_id')
      .eq('student_id', user.id);
    if (membershipError) return res.status(400).json({ error: membershipError.message });

    const classIds = Array.from(new Set((memberships || []).map((entry) => entry.class_id).filter(Boolean)));
    if (!classIds.length) return res.json({ submissions: [] });

    let assignmentQuery = readClient
      .from('assignments')
      .select('id')
      .in('class_id', classIds)
      .eq('status', 'published');
    if (requestedAssignmentIds.length) {
      assignmentQuery = assignmentQuery.in('id', requestedAssignmentIds);
    }

    const { data: assignments, error: assignmentError } = await assignmentQuery;
    if (assignmentError) return res.status(400).json({ error: assignmentError.message });

    const assignmentIds = Array.from(new Set((assignments || []).map((assignment) => assignment.id).filter(Boolean)));
    if (!assignmentIds.length) return res.json({ submissions: [] });

    const { data, error } = await readClient
      .from('submissions')
      .select('*')
      .eq('student_id', user.id)
      .in('assignment_id', assignmentIds);
    if (error) return res.status(400).json({ error: error.message });

    res.json({ submissions: (data || []).map(normalizeStudentVisibleSubmission) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get or create student's own submission
app.get('/api/assignments/:assignmentId/my-submission', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const readClient = getRequestScopedSupabase(req);
    const accessibleAssignment = await ensureStudentCanAccessAssignment(req.params.assignmentId, user.id, readClient);
    if (!accessibleAssignment) {
      return res.status(403).json({ error: 'You do not have access to this assignment.' });
    }
    const submissionClient = readClient;
    let { data, error } = await submissionClient
      .from('submissions')
      .select('*')
      .eq('assignment_id', req.params.assignmentId)
      .eq('student_id', user.id)
      .single();
    if (error && error.code === 'PGRST116') {
      // No submission yet - create one using the student's authenticated session when available.
      const { data: newData, error: createError } = await submissionWriteWithFallback(req, (client) => client
        .from('submissions')
        .insert({
          assignment_id: req.params.assignmentId,
          student_id: user.id,
          started_at: new Date().toISOString(),
        })
        .select()
        .single());
      if (createError) return res.status(400).json({ error: createError.message });
      data = newData;
    } else if (error) {
      return res.status(400).json({ error: error.message });
    }
    res.json({ submission: normalizeStudentVisibleSubmission(data) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function summarizeSubmissionForDebug(submission = null) {
  if (!submission) return null;
  const review = submission.teacher_review || submission.teacherReview || {};
  const rowScores = Array.isArray(review.rowScores || review.row_scores) ? (review.rowScores || review.row_scores) : [];
  const annotations = Array.isArray(review.annotations) ? review.annotations : [];
  return {
    id: submission.id || null,
    assignment_id: submission.assignment_id || submission.assignmentId || null,
    student_id: submission.student_id || submission.studentId || null,
    status: submission.status || null,
    submitted_at: submission.submitted_at || submission.submittedAt || null,
    updated_at: submission.updated_at || submission.updatedAt || null,
    teacher_review: {
      status: review.status || null,
      savedAt: review.savedAt || review.saved_at || null,
      finalScore: review.finalScore ?? review.final_score ?? null,
      finalNotesLength: String(review.finalNotes || review.final_notes || '').length,
      rowScoresCount: rowScores.length,
      annotationsCount: annotations.length,
    },
    finalTextLength: String(submission.final_text || submission.finalText || '').length,
    draftTextLength: String(submission.draft_text || submission.draftText || '').length,
  };
}

app.get('/api/debug/submission-state', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const profile = await getProfile(user.id);
    if (!profile) return res.status(409).json({ error: ACCOUNT_SETUP_INCOMPLETE_MESSAGE });

    const assignmentId = String(req.query.assignmentId || '').trim();
    if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });

    const readClient = getRequestScopedSupabase(req);
    let targetStudentId = String(req.query.studentId || '').trim();
    let assignment = null;

    if (profile.role === 'student') {
      targetStudentId = user.id;
      assignment = await ensureStudentCanAccessAssignment(assignmentId, targetStudentId, readClient);
      if (!assignment) return res.status(403).json({ error: 'You do not have access to this assignment.' });
    } else if (profile.role === 'teacher' || profile.role === 'admin') {
      if (!targetStudentId) return res.status(400).json({ error: 'studentId required for teacher debug' });
      assignment = await ensureTeacherOwnsAssignment(assignmentId, user.id, readClient);
      if (!assignment) return res.status(403).json({ error: 'You can only debug submissions for your own assignments.' });
    } else {
      return res.status(403).json({ error: 'Unsupported role for debug endpoint.' });
    }

    const scopedResult = await readClient
      .from('submissions')
      .select('*')
      .eq('assignment_id', assignmentId)
      .eq('student_id', targetStudentId)
      .maybeSingle();

    const rawResult = await supabase
      .from('submissions')
      .select('*')
      .eq('assignment_id', assignmentId)
      .eq('student_id', targetStudentId)
      .maybeSingle();

    if (scopedResult.error) return res.status(400).json({ error: scopedResult.error.message });
    if (rawResult.error) return res.status(400).json({ error: rawResult.error.message });

    res.json({
      checkedAt: new Date().toISOString(),
      viewer: {
        id: user.id,
        role: profile.role,
      },
      assignment: {
        id: assignment.id,
        title: assignment.title,
        status: assignment.status,
        class_id: assignment.class_id,
      },
      targetStudentId,
      requestScoped: summarizeSubmissionForDebug(scopedResult.data),
      rawServer: summarizeSubmissionForDebug(rawResult.data),
      studentVisibleNormalized: summarizeSubmissionForDebug(normalizeStudentVisibleSubmission(rawResult.data)),
    });
  } catch (error) {
    console.error('Debug submission-state failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Submit student's own work atomically
app.post('/api/assignments/:assignmentId/submit', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const readClient = getRequestScopedSupabase(req);
    const accessibleAssignment = await ensureStudentCanAccessAssignment(req.params.assignmentId, user.id, readClient);
    if (!accessibleAssignment) {
      return res.status(403).json({ error: 'You do not have access to this assignment.' });
    }

    const payload = sanitizeStudentSubmissionPayload(req.body);
    const submittedAt = new Date().toISOString();
    const nextPayload = {
      ...payload,
      status: 'submitted',
      submitted_at: submittedAt,
      teacher_review: createOpenTeacherReview(),
      updated_at: new Date().toISOString(),
    };

    const submissionClient = readClient;
    const { data: existing, error: existingError } = await submissionClient
      .from('submissions')
      .select('id')
      .eq('assignment_id', req.params.assignmentId)
      .eq('student_id', user.id)
      .maybeSingle();
    if (existingError) return res.status(400).json({ error: existingError.message });

    if (existing?.id) {
      const { data, error } = await submissionWriteWithFallback(req, (client) => client
        .from('submissions')
        .update(nextPayload)
        .eq('id', existing.id)
        .select('*, profiles(id, name)')
        .single());
      if (error) return res.status(400).json({ error: error.message });
      await waitForNotifications('Teacher submission notification email', [
        notifyTeacherAboutStudentSubmission({
          assignment: accessibleAssignment,
          submission: data,
          baseUrl: getConfiguredPublicBaseUrl() || getRequestBaseUrl(req),
        }),
      ]);
      return res.json({ submission: data });
    }

    const { data, error } = await submissionWriteWithFallback(req, (client) => client
      .from('submissions')
      .insert({
        assignment_id: req.params.assignmentId,
        student_id: user.id,
        started_at: nextPayload.started_at || new Date().toISOString(),
        ...nextPayload,
      })
      .select('*, profiles(id, name)')
      .single());
    if (error) return res.status(400).json({ error: error.message });
    await waitForNotifications('Teacher submission notification email', [
      notifyTeacherAboutStudentSubmission({
        assignment: accessibleAssignment,
        submission: data,
        baseUrl: getConfiguredPublicBaseUrl() || getRequestBaseUrl(req),
      }),
    ]);
    res.json({ submission: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upsert a submission shell for teacher review/status updates
app.put('/api/assignments/:assignmentId/students/:studentId/submission', async (req, res) => {
  try {
    const { user, error: teacherError, status } = await requireTeacherProfile(req);
    if (teacherError) return res.status(status).json({ error: teacherError });

    const assignmentId = req.params.assignmentId;
    const studentId = req.params.studentId;
    const readClient = getRequestScopedSupabase(req);
    const ownedAssignment = await ensureTeacherOwnsAssignment(assignmentId, user.id, readClient);
    if (!ownedAssignment) return res.status(403).json({ error: 'You can only review submissions for your own assignments.' });
    const enrolledStudent = await ensureStudentBelongsToClass(ownedAssignment.class_id, studentId, readClient);
    if (!enrolledStudent) return res.status(400).json({ error: 'That student is not enrolled in this class.' });
    const payload = submissionPayloadWithGradedStatus({
      ...sanitizeTeacherSubmissionPayload(req.body),
      updated_at: new Date().toISOString(),
    });

    const submissionClient = readClient;
    let { data, error } = await submissionClient
      .from('submissions')
      .select('id, status, teacher_review')
      .eq('assignment_id', assignmentId)
      .eq('student_id', studentId)
      .maybeSingle();

    if (error) return res.status(400).json({ error: error.message });

    if (data?.id) {
      const { data: updated, error: updateError } = await submissionWriteWithFallback(req, (client) => client
        .from('submissions')
        .update(payload)
        .eq('id', data.id)
        .select('*, profiles(id, name)')
        .single());
      if (updateError) return res.status(400).json({ error: updateError.message });
      await waitForNotifications('Student review notification email', [
        notifyStudentAboutGradedSubmission({
          assignment: ownedAssignment,
          submission: updated,
          previousTeacherReview: data.teacher_review,
          baseUrl: getConfiguredPublicBaseUrl() || getRequestBaseUrl(req),
        }),
        notifyStudentAboutReopenedSubmission({
          assignment: ownedAssignment,
          previousSubmission: data,
          submission: updated,
          baseUrl: getConfiguredPublicBaseUrl() || getRequestBaseUrl(req),
        }),
      ]);
      return res.json({ submission: updated });
    }

    const { data: created, error: createError } = await submissionWriteWithFallback(req, (client) => client
      .from('submissions')
      .insert({
        assignment_id: assignmentId,
        student_id: studentId,
        started_at: payload.started_at || null,
        ...payload,
      })
      .select('*, profiles(id, name)')
      .single());

    if (createError) return res.status(400).json({ error: createError.message });
    await waitForNotifications('Student review notification email', [
      notifyStudentAboutGradedSubmission({
        assignment: ownedAssignment,
        submission: created,
        previousTeacherReview: null,
        baseUrl: getConfiguredPublicBaseUrl() || getRequestBaseUrl(req),
      }),
      notifyStudentAboutReopenedSubmission({
        assignment: ownedAssignment,
        previousSubmission: null,
        submission: created,
        baseUrl: getConfiguredPublicBaseUrl() || getRequestBaseUrl(req),
      }),
    ]);
    res.json({ submission: created });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update submission
app.patch('/api/submissions/:id', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const readClient = getRequestScopedSupabase(req);
    const submission = await getSubmissionRecord(req.params.id, readClient);
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    let ownedAssignment = null;
    if (submission.student_id !== user.id) {
      ownedAssignment = await ensureTeacherOwnsAssignment(submission.assignment_id, user.id, readClient);
      if (!ownedAssignment) {
        return res.status(403).json({ error: 'You do not have permission to update this submission.' });
      }
    }
    const isStudentOwner = submission.student_id === user.id;
    const payload = isStudentOwner
      ? {
          ...sanitizeStudentSubmissionPayload(req.body),
          updated_at: new Date().toISOString(),
        }
      : submissionPayloadWithGradedStatus({
          ...sanitizeTeacherSubmissionPayload(req.body),
          updated_at: new Date().toISOString(),
        });

    const { data, error } = await submissionWriteWithFallback(req, (client) => client
      .from('submissions')
      .update(payload)
      .eq('id', req.params.id)
      .select('*, profiles(id, name)')
      .single());
    if (error) return res.status(400).json({ error: error.message });
    if (ownedAssignment) {
      await waitForNotifications('Student review notification email', [
        notifyStudentAboutGradedSubmission({
          assignment: ownedAssignment,
          submission: data,
          previousTeacherReview: submission.teacher_review,
          baseUrl: getConfiguredPublicBaseUrl() || getRequestBaseUrl(req),
        }),
        notifyStudentAboutReopenedSubmission({
          assignment: ownedAssignment,
          previousSubmission: submission,
          submission: data,
          baseUrl: getConfiguredPublicBaseUrl() || getRequestBaseUrl(req),
        }),
      ]);
    }
    res.json({ submission: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/submissions/:id/process-analysis', async (req, res) => {
  try {
    const context = await getProcessAnalysisContext(req, req.params.id);
    if (context.error) return res.status(context.status).json({ error: context.error });
    const result = await computeAndStoreProcessAnalysis(context, { store: true });
    res.json({
      analysis: result.analysis,
      stored: result.stored,
      inputHash: result.inputHash,
      storageWarning: result.storageError || '',
    });
  } catch (error) {
    console.error('Process analysis endpoint failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/submissions/:id/process-analysis/recompute', async (req, res) => {
  try {
    const context = await getProcessAnalysisContext(req, req.params.id);
    if (context.error) return res.status(context.status).json({ error: context.error });
    if (context.viewerProfile.role !== 'teacher' && context.viewerProfile.role !== 'admin') {
      return res.status(403).json({ error: 'Teacher access required' });
    }
    const result = await computeAndStoreProcessAnalysis(context, { store: true });
    res.json({
      analysis: result.analysis,
      stored: result.stored,
      inputHash: result.inputHash,
      storageWarning: result.storageError || '',
    });
  } catch (error) {
    console.error('Process analysis recompute failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/submissions/:id/process-label', async (req, res) => {
  try {
    const context = await getProcessAnalysisContext(req, req.params.id);
    if (context.error) return res.status(context.status).json({ error: context.error });
    if (context.viewerProfile.role !== 'teacher' && context.viewerProfile.role !== 'admin') {
      return res.status(403).json({ error: 'Teacher access required' });
    }

    const label = String(req.body?.label || '').trim().slice(0, 80);
    const notes = String(req.body?.notes || '').trim().slice(0, 2000);
    if (!label) return res.status(400).json({ error: 'label is required' });

    const analysisResult = await computeAndStoreProcessAnalysis(context, { store: true });
    const { data, error } = await supabase
      .from('submission_process_labels')
      .insert({
        submission_id: context.submission.id,
        analysis_id: analysisResult.stored?.id || null,
        reviewer_id: context.user.id,
        label,
        notes,
        excluded_from_training: Boolean(req.body?.excludedFromTraining),
      })
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({
      label: data,
      analysis: analysisResult.analysis,
      storageWarning: analysisResult.storageError || '',
    });
  } catch (error) {
    console.error('Process label save failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Admin endpoints ──────────────────────────────────────────

async function requireAdmin(req, res) {
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  const profile = await getProfile(user.id);
  if (profile?.role !== 'admin') { res.status(403).json({ error: 'Admin only' }); return null; }
  return user;
}

function isMissingProfileFlagColumn(error) {
  return Boolean(error?.message && /is_test_account|column .* does not exist/i.test(error.message));
}

function addDefaultProfileFlags(profile) {
  if (!profile) return profile;
  return {
    ...profile,
    is_test_account: Boolean(profile.is_test_account),
  };
}

function isStudentProfile(profile) {
  return String(profile?.role || '').trim().toLowerCase() === 'student';
}

app.get('/api/admin/teachers', async (req, res) => {
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const readClient = getRequestScopedSupabase(req);
    let { data, error } = await readClient
      .from('profiles')
      .select('id, name, role, created_at, is_test_account')
      .in('role', ['teacher', 'admin'])
      .order('created_at', { ascending: false });
    if (error && isMissingProfileFlagColumn(error)) {
      const retry = await readClient
        .from('profiles')
        .select('id, name, role, created_at')
        .in('role', ['teacher', 'admin'])
        .order('created_at', { ascending: false });
      data = (retry.data || []).map(addDefaultProfileFlags);
      error = retry.error;
    }
    if (error) return res.status(400).json({ error: error.message });
    // Get class counts per teacher
    const { data: classes } = await readClient
      .from('classes')
      .select('id, teacher_id, name');
    const { data: assignments } = await readClient
      .from('assignments')
      .select('id, class_id, status');
    const { data: members } = await readClient
      .from('class_members')
      .select('class_id, student_id');
    const teachers = (data || []).map(teacher => {
      const teacherClasses = (classes || []).filter(c => c.teacher_id === teacher.id);
      const classIds = teacherClasses.map(c => c.id);
      const teacherAssignments = (assignments || []).filter(a => classIds.includes(a.class_id));
      const teacherStudents = new Set((members || []).filter(m => classIds.includes(m.class_id)).map(m => m.student_id));
      return {
        ...teacher,
        classCount: teacherClasses.length,
        assignmentCount: teacherAssignments.length,
        publishedCount: teacherAssignments.filter(a => a.status === 'published').length,
        studentCount: teacherStudents.size,
        classes: teacherClasses,
      };
    });
    res.json({ teachers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/teachers/:teacherId/classes', async (req, res) => {
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const readClient = getRequestScopedSupabase(req);
    let { data: classes, error } = await readClient
      .from('classes')
      .select('*, class_members(student_id, profiles(id, name, role, is_test_account))')
      .eq('teacher_id', req.params.teacherId)
      .order('created_at', { ascending: false });
    if (error && isMissingProfileFlagColumn(error)) {
      const retry = await readClient
        .from('classes')
        .select('*, class_members(student_id, profiles(id, name, role))')
        .eq('teacher_id', req.params.teacherId)
        .order('created_at', { ascending: false });
      classes = (Array.isArray(retry.data) ? retry.data : []).map((cls) => ({
        ...cls,
        class_members: (Array.isArray(cls.class_members) ? cls.class_members : []).map((member) => ({
          ...member,
          profiles: addDefaultProfileFlags(member.profiles),
        })),
      }));
      error = retry.error;
    }
    if (error) return res.status(400).json({ error: error.message });
    classes = (Array.isArray(classes) ? classes : []).map((cls) => ({
      ...cls,
      class_members: (Array.isArray(cls.class_members) ? cls.class_members : [])
        .filter((member) => isStudentProfile(member.profiles)),
    }));
    res.json({ classes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/classes/:classId/detail', async (req, res) => {
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const readClient = getRequestScopedSupabase(req);
    const assignPromise = readClient.from('assignments').select('*').eq('class_id', req.params.classId).order('created_at', { ascending: false });
    let memberPromise = readClient.from('class_members').select('student_id, profiles(id, name, role, is_test_account)').eq('class_id', req.params.classId);
    let [assignData, memberData] = await Promise.all([
      assignPromise,
      memberPromise
    ]);
    if (memberData.error && isMissingProfileFlagColumn(memberData.error)) {
      memberData = await readClient.from('class_members').select('student_id, profiles(id, name, role)').eq('class_id', req.params.classId);
      memberData.data = (Array.isArray(memberData.data) ? memberData.data : []).map((member) => ({
        ...member,
        profiles: addDefaultProfileFlags(member.profiles),
      }));
    }
    if (assignData.error) return res.status(400).json({ error: assignData.error.message });
    if (memberData.error) return res.status(400).json({ error: memberData.error.message });
    const assignments = assignData.data || [];
    const members = (memberData.data || []).map(m => m.profiles).filter(isStudentProfile);
    // Get submissions for all assignments in this class
    const assignmentIds = assignments.map(a => a.id);
    let submissions = [];
    if (assignmentIds.length) {
      const { data: subs } = await readClient
        .from('submissions')
        .select('*, profiles(id, name)')
        .in('assignment_id', assignmentIds);
      submissions = subs || [];
    }
    res.json({ assignments, members, submissions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/admin/students/:studentId/flags', async (req, res) => {
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const isTestAccount = Boolean(req.body?.isTestAccount);
    const { data, error } = await supabase
      .from('profiles')
      .update({
        is_test_account: isTestAccount,
      })
      .eq('id', req.params.studentId)
      .eq('role', 'student')
      .select('id, name, role, is_test_account')
      .maybeSingle();
    if (error) {
      if (isMissingProfileFlagColumn(error)) {
        return res.status(400).json({
          error: 'Admin test-account flags are not active yet. Apply the latest profile admin flags migration, then try again.',
          needsMigration: true,
          migration: '20260507_profile_admin_flags.sql',
        });
      }
      return res.status(400).json({ error: error.message });
    }
    if (!data) return res.status(404).json({ error: 'Student profile not found.' });
    res.json({ profile: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/process-analytics', async (req, res) => {
  try {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const { data: analyses, error } = await supabase
      .from('submission_process_analyses')
      .select('id, submission_id, assignment_id, class_id, student_id, analysis_version, process_status, excluded_from_analytics, exclusion_sources, calculated_at');
    if (error) {
      return res.status(400).json({
        error: error.message,
        needsMigration: /submission_process_analyses/i.test(error.message || ''),
      });
    }

    const rows = analyses || [];
    const summary = {
      totalAnalyses: rows.length,
      includedAnalyses: rows.filter((row) => !row.excluded_from_analytics).length,
      excludedAnalyses: rows.filter((row) => row.excluded_from_analytics).length,
      versions: {},
      statuses: {},
      exclusionSources: {},
      cohortSampleSize: rows.filter((row) => !row.excluded_from_analytics).length,
    };

    rows.forEach((row) => {
      const version = row.analysis_version || 'unknown';
      const status = row.process_status || 'unknown';
      summary.versions[version] = (summary.versions[version] || 0) + 1;
      summary.statuses[status] = (summary.statuses[status] || 0) + 1;
      (Array.isArray(row.exclusion_sources) ? row.exclusion_sources : []).forEach((source) => {
        summary.exclusionSources[source] = (summary.exclusionSources[source] || 0) + 1;
      });
    });

    res.json({ summary, analyses: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
  if (canSendNotificationEmails()) {
    processUpcomingDeadlineReminders().catch((error) => {
      console.error('Initial deadline reminder check failed:', error);
    });
    if (deadlineReminderJob) clearInterval(deadlineReminderJob);
    deadlineReminderJob = setInterval(() => {
      processUpcomingDeadlineReminders().catch((error) => {
        console.error('Scheduled deadline reminder check failed:', error);
      });
    }, DEADLINE_REMINDER_POLL_MS);
  } else {
    console.log('Email notifications are disabled. Set RESEND_API_KEY and NOTIFY_FROM_EMAIL to enable publish/deadline emails.');
  }
});
