require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const { parseRubricBuffer, parseRubricText } = require('./rubricParser');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const app = express();
app.use(express.static(__dirname));
app.use(express.json());

// Supabase admin client (service role — server only)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Helper to get authenticated user from request
async function getUser(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
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

async function requireTeacherProfile(req) {
  const user = await getUser(req);
  if (!user) return { user: null, profile: null, error: 'Not authenticated', status: 401 };
  const profile = await getProfile(user.id);
  if (profile?.role !== 'teacher') {
    return { user, profile, error: 'Teacher access required', status: 403 };
  }
  return { user, profile, error: null, status: 200 };
}

async function ensureTeacherOwnsClass(classId, teacherId) {
  const { data, error } = await supabase
    .from('classes')
    .select('id, teacher_id, name')
    .eq('id', classId)
    .eq('teacher_id', teacherId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function ensureTeacherOwnsAssignment(assignmentId, teacherId) {
  const { data, error } = await supabase
    .from('assignments')
    .select('id, class_id, title')
    .eq('id', assignmentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const ownedClass = await ensureTeacherOwnsClass(data.class_id, teacherId);
  return ownedClass ? data : null;
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
    const { prompt, messages, system } = req.body;
    const apiMessages = messages || [{ role: "user", content: prompt }];
    const requestBody = {
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: apiMessages,
    };
    if (system) requestBody.system = system;

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
  try {
    const { email, password, name, role } = req.body;
    if (!email || !password || !name || !role) {
      return res.status(400).json({ error: 'email, password, name and role are required' });
    }
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name, role },
      email_confirm: true,
    });
    if (error) return res.status(400).json({ error: error.message });

    // Create profile manually instead of relying on trigger
    await supabase.from('profiles').insert({
      id: data.user.id,
      name,
      role,
    });

    res.json({ user: data.user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sign in
app.post('/api/auth/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: error.message });
    const profile = await getProfile(data.user.id);
    res.json({ session: data.session, profile });
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
    const redirectFromClient = String(requestedRedirect || '').trim();
    const safeClientRedirect = /^https?:\/\//i.test(redirectFromClient) && !/localhost(?::\d+)?/i.test(redirectFromClient)
      ? redirectFromClient.replace(/\/+$/, '')
      : '';
    const redirectTo = `${safeClientRedirect || getRequestBaseUrl(req)}/?reset=1`;
    const { error } = await supabase.auth.resetPasswordForEmail(String(email).trim(), {
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
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current user profile
app.get('/api/auth/me', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const profile = await getProfile(user.id);
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
    const { data, error } = await supabase
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
    const { data, error } = await supabase
      .from('classes')
      .insert({ name, teacher_id: user.id })
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ class: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add student to class
app.post('/api/classes/:classId/members', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const { studentEmail } = req.body;
    // Find student by email
    const { data: students, error: findError } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'student');
    if (findError) return res.status(400).json({ error: findError.message });
    // Look up auth user by email using admin API
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const authUser = authUsers.users.find(u => u.email === studentEmail);
    if (!authUser) return res.status(404).json({ error: 'No student found with that email' });
    const { error } = await supabase
      .from('class_members')
      .insert({ class_id: req.params.classId, student_id: authUser.id });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get classes for a student
app.get('/api/student/classes', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const { data, error } = await supabase
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
    const { error } = await supabase
      .from('class_members')
      .upsert({ class_id: req.params.classId, student_id: user.id });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/classes/:classId/members', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const { data, error } = await supabase
      .from('class_members')
      .select('student_id, profiles(id, name)')
      .eq('class_id', req.params.classId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ members: data.map(d => d.profiles) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Assignments endpoints ────────────────────────────────────

function sanitizeAssignmentPayload(payload = {}) {
  const next = { ...payload };
  delete next.uploaded_rubric_name;
  delete next.uploadedRubricName;
  return next;
}

// Get assignments for a class
app.get('/api/classes/:classId/assignments', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const { data, error } = await supabase
      .from('assignments')
      .select('*')
      .eq('class_id', req.params.classId)
      .order('created_at', { ascending: false });
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
    const ownedClass = await ensureTeacherOwnsClass(req.params.classId, user.id);
    if (!ownedClass) return res.status(403).json({ error: 'You can only add assignments to your own classes.' });
    const payload = sanitizeAssignmentPayload(req.body);
    const { data, error } = await supabase
      .from('assignments')
      .insert({ ...payload, class_id: req.params.classId })
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
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
    const ownedAssignment = await ensureTeacherOwnsAssignment(req.params.id, user.id);
    if (!ownedAssignment) return res.status(403).json({ error: 'You can only update assignments in your own classes.' });
    const payload = sanitizeAssignmentPayload(req.body);
    const { data, error } = await supabase
      .from('assignments')
      .update(payload)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
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
    const ownedAssignment = await ensureTeacherOwnsAssignment(req.params.id, user.id);
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
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const { data, error } = await supabase
      .from('submissions')
      .select('*, profiles(id, name)')
      .eq('assignment_id', req.params.assignmentId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ submissions: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get or create student's own submission
app.get('/api/assignments/:assignmentId/my-submission', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    let { data, error } = await supabase
      .from('submissions')
      .select('*')
      .eq('assignment_id', req.params.assignmentId)
      .eq('student_id', user.id)
      .single();
    if (error && error.code === 'PGRST116') {
      // No submission yet — create one
      const { data: newData, error: createError } = await supabase
        .from('submissions')
        .insert({
          assignment_id: req.params.assignmentId,
          student_id: user.id,
          started_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (createError) return res.status(400).json({ error: createError.message });
      data = newData;
    } else if (error) {
      return res.status(400).json({ error: error.message });
    }
    res.json({ submission: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upsert a submission shell for teacher review/status updates
app.put('/api/assignments/:assignmentId/students/:studentId/submission', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const profile = await getProfile(user.id);
    if (profile?.role !== 'teacher') return res.status(403).json({ error: 'Teacher access required' });

    const assignmentId = req.params.assignmentId;
    const studentId = req.params.studentId;
    const payload = { ...req.body, updated_at: new Date().toISOString() };

    let { data, error } = await supabase
      .from('submissions')
      .select('id')
      .eq('assignment_id', assignmentId)
      .eq('student_id', studentId)
      .maybeSingle();

    if (error) return res.status(400).json({ error: error.message });

    if (data?.id) {
      const { data: updated, error: updateError } = await supabase
        .from('submissions')
        .update(payload)
        .eq('id', data.id)
        .select('*, profiles(id, name)')
        .single();
      if (updateError) return res.status(400).json({ error: updateError.message });
      return res.json({ submission: updated });
    }

    const { data: created, error: createError } = await supabase
      .from('submissions')
      .insert({
        assignment_id: assignmentId,
        student_id: studentId,
        started_at: payload.started_at || null,
        ...payload,
      })
      .select('*, profiles(id, name)')
      .single();

    if (createError) return res.status(400).json({ error: createError.message });
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
    const { data, error } = await supabase
      .from('submissions')
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('*, profiles(id, name)')
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ submission: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
