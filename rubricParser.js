const fs = require('fs');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const fetch = require('node-fetch');

const SYSTEM_PROMPT = `
You are an expert academic rubric parser.
Your job is to read raw rubric text, which may be messy, tab-separated, OCR'd, or copied out of a table,
and return a single valid JSON object that conforms EXACTLY to the schema below.

SCHEMA:
{
  "title": string,
  "subtitle": string,
  "totalPoints": number,
  "notes": string[],
  "criteria": [
    {
      "id": string,
      "name": string,
      "minScore": number,
      "maxScore": number,
      "levels": [
        {
          "label": string,
          "score": number,
          "description": string
        }
      ]
    }
  ],
  "attribution": string
}

RULES:
- Output JSON only. No markdown fences or explanation.
- Preserve the rubric's real criteria and level labels. Do not invent new rows.
- Keep levels ordered from highest score to lowest score.
- If a score range appears, use the higher score for that level and keep minScore accurate.
- Put deduction rules or special instructions into notes.
- Preserve meaningful wording from the source so the rubric still feels like the original document.
- If a field is missing, use an empty string or a sensible default.
`.trim();

function slugifyRubricId(text, fallback = 'criterion') {
  const cleaned = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function normalizeRubricSchema(schema = {}, fileName = 'Uploaded rubric') {
  const criteria = Array.isArray(schema?.criteria)
    ? schema.criteria
        .map((criterion, criterionIndex) => {
          const rawLevels = Array.isArray(criterion?.levels) ? criterion.levels : [];
          const levels = rawLevels
            .map((level, levelIndex) => ({
              id: level?.id || `${slugifyRubricId(criterion?.id || criterion?.name || `criterion-${criterionIndex + 1}`, `criterion-${criterionIndex + 1}`)}-level-${levelIndex + 1}`,
              label: String(level?.label || '').trim() || `Level ${levelIndex + 1}`,
              score: Number(level?.score ?? 0),
              description: String(level?.description || '').trim(),
            }))
            .filter((level) => level.label || level.description || Number.isFinite(level.score))
            .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

          if (!levels.length) return null;

          const maxScore = Number(
            criterion?.maxScore ??
            Math.max(...levels.map((level) => Number(level.score || 0)), 0)
          );
          const minScore = Number(
            criterion?.minScore ??
            Math.min(...levels.map((level) => Number(level.score || 0)), maxScore)
          );

          return {
            id: String(criterion?.id || slugifyRubricId(criterion?.name || `criterion-${criterionIndex + 1}`, `criterion-${criterionIndex + 1}`)).trim(),
            name: String(criterion?.name || `Criterion ${criterionIndex + 1}`).trim(),
            minScore,
            maxScore,
            levels,
          };
        })
        .filter(Boolean)
    : [];

  const totalPoints = Number(schema?.totalPoints || criteria.reduce((sum, criterion) => sum + Number(criterion.maxScore || 0), 0));

  return {
    title: String(schema?.title || fileName || 'Uploaded rubric').trim(),
    subtitle: String(schema?.subtitle || '').trim(),
    totalPoints: Number.isFinite(totalPoints) ? totalPoints : 0,
    notes: (Array.isArray(schema?.notes) ? schema.notes : [])
      .map((note) => String(note || '').trim())
      .filter(Boolean),
    criteria,
    attribution: String(schema?.attribution || '').trim(),
  };
}

function rubricSchemaToMatrix(schema = {}, fileName = 'Uploaded rubric') {
  const normalized = normalizeRubricSchema(schema, fileName);
  if (!normalized.criteria.length) return null;

  return {
    kind: 'matrix',
    name: normalized.title || fileName || 'Uploaded rubric',
    headers: normalized.criteria[0].levels.map((level) => `${level.label} – ${level.score}`),
    notes: [
      normalized.subtitle,
      ...normalized.notes,
      normalized.attribution,
    ].filter(Boolean),
    rows: normalized.criteria.map((criterion) => ({
      id: criterion.id,
      section: '',
      subcriterion: criterion.name,
      name: criterion.name,
      description: '',
      points: Number(criterion.maxScore || 0),
      pointsLabel: criterion.minScore !== criterion.maxScore
        ? `${criterion.minScore} – ${criterion.maxScore} points`
        : `${criterion.maxScore} points`,
      levels: criterion.levels.map((level) => ({
        id: level.id,
        label: `${level.label} – ${level.score}`,
        points: Number(level.score || 0),
        description: level.description,
      })),
    })),
  };
}

async function extractTextFromBuffer(buffer, mimeType = '', fileName = '') {
  const lowerName = String(fileName || '').toLowerCase();

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword' ||
    lowerName.endsWith('.docx') ||
    lowerName.endsWith('.doc')
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return String(result?.value || '').trim();
  }

  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
    const result = await pdfParse(buffer);
    return String(result?.text || '').trim();
  }

  return buffer.toString('utf8').trim();
}

async function parseWithClaude(rawText, fileName = 'Uploaded rubric') {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required to parse uploaded rubrics.');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `File name: ${fileName}\n\nParse the following rubric text into the JSON schema.\n\n${rawText}`,
        },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Claude rubric parse failed (${response.status})`);
  }

  const raw = Array.isArray(data?.content)
    ? data.content.filter((block) => block.type === 'text').map((block) => block.text).join('')
    : '';
  const cleaned = raw.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`Claude returned invalid rubric JSON: ${error.message}`);
  }

  return normalizeRubricSchema(parsed, fileName);
}

async function parseRubricBuffer(buffer, mimeType = '', fileName = 'Uploaded rubric') {
  const text = await extractTextFromBuffer(buffer, mimeType, fileName);
  const schema = await parseWithClaude(text, fileName);
  return {
    text,
    schema,
    rubricData: rubricSchemaToMatrix(schema, fileName),
  };
}

async function parseRubricFile(filePath, mimeType = '') {
  const buffer = fs.readFileSync(filePath);
  return parseRubricBuffer(buffer, mimeType, filePath.split('/').pop() || 'Uploaded rubric');
}

async function parseRubricText(rawText, fileName = 'Uploaded rubric') {
  const text = String(rawText || '').trim();
  const schema = await parseWithClaude(text, fileName);
  return {
    text,
    schema,
    rubricData: rubricSchemaToMatrix(schema, fileName),
  };
}

module.exports = {
  extractTextFromBuffer,
  normalizeRubricSchema,
  parseRubricBuffer,
  parseRubricFile,
  parseRubricText,
  rubricSchemaToMatrix,
};
