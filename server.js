require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const mammoth = require('mammoth');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
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

function decodeHtmlEntities(text = '') {
  return String(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtmlPreservingLines(html = '') {
  return decodeHtmlEntities(
    String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function cleanRubricCellText(text = '') {
  return stripHtmlPreservingLines(text)
    .replace(/\s*\|\s*/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function decodeXmlEntities(text = '') {
  return String(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
}

function extractWordXmlText(xml = '') {
  return decodeXmlEntities(
    String(xml)
      .replace(/<w:tab\b[^>]*\/>/gi, '\t')
      .replace(/<w:(?:br|cr)\b[^>]*\/>/gi, '\n')
      .replace(/<\/w:p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function cleanRubricXmlCellText(xml = '') {
  return extractWordXmlText(xml)
    .replace(/\s*\|\s*/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function normalizeSectionLabel(sectionText = '') {
  const lines = cleanRubricXmlCellText(sectionText)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return '';
  if (lines.length >= 4 && /^[A-Z\s]+$/.test(lines[0])) {
    return lines[0];
  }
  return lines.join(' ').replace(/[ ]{2,}/g, ' ').trim();
}

function parseLevelPoints(label = '') {
  const matches = String(label).match(/\d+(?:\.\d+)?/g) || [];
  if (!matches.length) return 0;
  const values = matches.map(Number).filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  if (values.length === 1) return values[0];
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function deriveSubcriterionName(sectionText = '', firstDescription = '', rowIndex = 0, seenCount = 0) {
  const cleanedSection = normalizeSectionLabel(sectionText);
  const rawLines = cleanRubricXmlCellText(sectionText)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!seenCount && cleanedSection && cleanedSection.length <= 40 && !String(sectionText).includes('\n')) {
    return cleanedSection;
  }

  const firstSentence = cleanRubricCellText(firstDescription).split(/[.;:\n]/)[0] || '';
  const firstWords = firstSentence
    .replace(/[,:-]+$/, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if ((seenCount > 0 || rawLines.length >= 4) && firstWords.length >= 2) {
    return firstWords.slice(0, 2).join(' ');
  }

  const phraseMatch = firstSentence.match(/^(.{0,80}?)\b(is|are|may|can|will|should|must|contains?|explains?|builds?|groups?|presents?|uses?|shows?|restates?|supports?)\b/i);
  const candidate = (phraseMatch ? phraseMatch[1] : firstSentence)
    .replace(/\b(thoroughly|adequately|successfully|partially|clearly|effectively|usually|generally|strongly)\b$/i, '')
    .replace(/[,:-]+$/, '')
    .trim();

  if (candidate && candidate.split(/\s+/).length <= 8 && candidate.length <= 48) {
    return candidate;
  }

  return cleanedSection || `Criterion ${rowIndex + 1}`;
}

function extractDocxDocumentXml(buffer) {
  const tempPath = path.join(
    os.tmpdir(),
    `auizero-rubric-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`
  );
  fs.writeFileSync(tempPath, buffer);
  try {
    return execFileSync('unzip', ['-p', tempPath, 'word/document.xml'], {
      encoding: 'utf8',
      maxBuffer: 12 * 1024 * 1024,
    });
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch (error) {
      // Ignore cleanup failures.
    }
  }
}

function parseRubricDocxXml(documentXml = '', fileName = '') {
  const xml = String(documentXml);
  const tableMatches = [...xml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/gi)].map((match) => match[0]);
  if (!tableMatches.length) return null;

  const tableXml = tableMatches.sort((a, b) => b.length - a.length)[0];
  const preTableXml = xml.slice(0, xml.indexOf(tableXml));
  const notes = [...preTableXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/gi)]
    .map((match) => cleanRubricXmlCellText(match[0]))
    .filter(Boolean);

  const rowMatches = [...tableXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/gi)].map((match) => match[0]);
  if (rowMatches.length < 2) return null;

  const rows = rowMatches.map((rowXml) =>
    [...rowXml.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/gi)].map((match) => cleanRubricXmlCellText(match[0]))
  );

  const headerRow = rows[0] || [];
  if (headerRow.length < 3) return null;

  const hasPointsColumn = /points?/i.test(headerRow[headerRow.length - 1] || '');
  const levelHeaders = headerRow.slice(1, hasPointsColumn ? -1 : undefined).filter(Boolean);
  if (!levelHeaders.length) return null;

  let previousSection = '';
  const sectionCounts = new Map();
  const rowsOut = rows.slice(1).map((cells, index) => {
    const normalizedCells = [...cells];
    while (normalizedCells.length < headerRow.length) normalizedCells.push('');

    const rawSectionCell = normalizedCells[0] || '';
    const rawSection = normalizeSectionLabel(rawSectionCell);
    const section = rawSection || previousSection;
    if (rawSection) previousSection = rawSection;
    const seenCount = sectionCounts.get(section) || 0;
    sectionCounts.set(section, seenCount + 1);

    const descriptions = normalizedCells.slice(1, 1 + levelHeaders.length);
    const pointsLabel = hasPointsColumn ? cleanRubricXmlCellText(normalizedCells[headerRow.length - 1] || '') : '';
    const name = deriveSubcriterionName(rawSectionCell || section, descriptions[0], index, seenCount);
    const levels = levelHeaders.map((header, levelIndex) => ({
      id: `level-${index + 1}-${levelIndex + 1}`,
      label: header,
      points: parseLevelPoints(header),
      description: descriptions[levelIndex] || '',
    }));

    return {
      id: `rubric-row-${index + 1}`,
      section,
      subcriterion: name,
      name,
      description: pointsLabel || section,
      points: Math.max(...levels.map((level) => Number(level.points || 0)), 0),
      pointsLabel,
      levels,
    };
  }).filter((row) => row.section || row.levels.some((level) => level.description));

  if (!rowsOut.length) return null;

  return {
    kind: 'matrix',
    name: fileName || 'Uploaded rubric',
    headers: levelHeaders,
    rows: rowsOut,
    notes,
  };
}

function parseRubricHtmlTable(html = '', fileName = '') {
  const tableMatches = [...String(html).matchAll(/<table[\s\S]*?<\/table>/gi)].map((match) => match[0]);
  if (!tableMatches.length) return null;

  const tableHtml = tableMatches.sort((a, b) => b.length - a.length)[0];
  const rowMatches = [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((match) => match[0]);
  if (rowMatches.length < 2) return null;

  const rows = rowMatches.map((rowHtml) =>
    [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => cleanRubricCellText(match[1]))
  );

  const headerRow = rows[0];
  const hasPointsColumn = headerRow[headerRow.length - 1] === '' || rows.slice(1).every((row) => /points?/i.test(row[row.length - 1] || ''));
  const levelHeaders = headerRow.slice(1, hasPointsColumn ? -1 : undefined).filter(Boolean);
  if (!levelHeaders.length) return null;

  const notesHtml = String(html).slice(0, html.indexOf(tableHtml));
  const notes = [...notesHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => cleanRubricCellText(match[1]))
    .filter(Boolean);

  const sectionCounts = new Map();
  let previousSection = '';
  const rawRows = rows.slice(1).map((cells, index) => {
    const workingCells = [...cells];
    const pointsLabel = hasPointsColumn ? (workingCells.pop() || '') : '';
    const rawSectionCell = workingCells.shift() || '';
    const rawSection = normalizeSectionLabel(rawSectionCell);
    const section = rawSection || previousSection;
    if (rawSection) previousSection = rawSection;
    const seenCount = sectionCounts.get(section) || 0;
    sectionCounts.set(section, seenCount + 1);

    const descriptions = workingCells.slice(0, levelHeaders.length);
    const name = deriveSubcriterionName(rawSectionCell || section, descriptions[0], index, seenCount);
    const levels = levelHeaders.map((header, levelIndex) => ({
      id: `level-${index + 1}-${levelIndex + 1}`,
      label: header,
      points: parseLevelPoints(header),
      description: descriptions[levelIndex] || '',
    }));

    return {
      id: `rubric-row-${index + 1}`,
      section,
      subcriterion: name,
      name,
      description: pointsLabel || section,
      points: Math.max(...levels.map((level) => Number(level.points || 0)), 0),
      levels,
      pointsLabel,
    };
  }).filter((row) => row.levels.some((level) => level.description));

  const parsedRows = rawRows.map((row) => ({
    ...row,
    subcriterion: row.subcriterion || row.name,
  }));

  if (!parsedRows.length) return null;

  return {
    kind: 'matrix',
    name: fileName || 'Uploaded rubric',
    headers: levelHeaders,
    rows: parsedRows,
    notes,
  };
}

// ── Rubric upload endpoint ───────────────────────────────────
app.post('/api/extract-rubric', upload.single('rubric'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const mime = req.file.mimetype;
    let text = '';
    let rubricData = null;

    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mime === 'application/msword') {
      let documentXml = '';
      try {
        documentXml = extractDocxDocumentXml(req.file.buffer);
      } catch (xmlError) {
        documentXml = '';
      }

      const [rawTextResult, htmlResult] = await Promise.all([
        mammoth.extractRawText({ buffer: req.file.buffer }),
        mammoth.convertToHtml({ buffer: req.file.buffer }),
      ]);
      text = rawTextResult.value;
      rubricData = documentXml ? parseRubricDocxXml(documentXml, req.file.originalname) : null;
      if (!rubricData) rubricData = parseRubricHtmlTable(htmlResult.value, req.file.originalname);
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

    res.json({ text: text.trim(), rubricData });
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
