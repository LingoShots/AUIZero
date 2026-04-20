require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const mammoth = require('mammoth');
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

// ── Rubric upload endpoint ───────────────────────────────────
app.post('/api/extract-rubric', upload.single('rubric'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const mime = req.file.mimetype;
    let text = '';

    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mime === 'application/msword') {
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      text = result.value;
    } else if (mime === 'application/pdf') {
      // Use AI to extract text from PDF since we can't run native pdf libs easily
      const base64 = req.file.buffer.toString('base64');
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
              { type: 'text', text: 'Extract all the text from this rubric document. Return only the raw text content, preserving the structure as much as possible.' }
            ]
          }]
        })
      });
      const aiData = await aiRes.json();
      text = aiData.content?.[0]?.text || '';
    } else {
      return res.status(400).json({ error: 'Please upload a PDF or Word document' });
    }

    res.json({ text: text.trim() });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
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
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const { data, error } = await supabase
      .from('assignments')
      .insert({ ...req.body, class_id: req.params.classId })
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
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    const { data, error } = await supabase
      .from('assignments')
      .update(req.body)
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
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
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
