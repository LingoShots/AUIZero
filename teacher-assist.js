// teacher-assist.js
// Pure heuristics that power the "Create student-ready version" button on the
// teacher draft screen. Takes a teacher brief and infers an assignment type,
// title, prompt, rubric, word-range and focus points without calling out to
// an AI provider. Also applies AI-returned settings back onto ui.teacherDraft.
//
// All functions are pure transformations except applyAiSettingsToTeacherDraft,
// which mutates window.AppState.ui.teacherDraft properties in place.

(function () {
  const { uid, trimTo, titleCase } = window.CoreUtils;
  const { createScoreBandsForPoints } = window.ReviewUtils;
  const { combineDeadlineParts, getDeadlineTimePart } = window.DeadlineUtils;

  function requireLegacyAppFunction(name) {
    const dependency = window[name];
    if (typeof dependency !== "function") {
      throw new Error(`TeacherAssist missing dependency: window.${name}`);
    }
    return dependency;
  }

  const extractKeywords = (...args) => requireLegacyAppFunction("extractKeywords")(...args);
  const inferTeacherBriefSettings = (...args) => requireLegacyAppFunction("inferTeacherBriefSettings")(...args);

  function createSimpleRubricCriterion(name, description, points = 4) {
    const maxPoints = Math.max(1, Number(points || 4));
    return {
      id: uid("rubric"),
      name,
      description,
      points: maxPoints,
      bands: createScoreBandsForPoints(maxPoints),
    };
  }

  function detectAssignmentType(text) {
    const lower = text.toLowerCase();
    if (/\bargue\b|\bopinion\b|\bpersuade\b|\bshould\b/.test(lower)) return "argument";
    if (/\bnarrative\b|\bstory\b|\bpersonal\b|\bmemory\b/.test(lower)) return "narrative";
    if (/\bprocess\b|\bsteps\b|\bhow to\b|\bprocedure\b/.test(lower)) return "process";
    if (/\bdefin\b|\bmeaning\b|\bwhat is\b|\bconcept\b/.test(lower)) return "definition";
    if (/\bcompar\b|\bcontrast\b|\bdifference\b|\bsimilar\b/.test(lower)) return "compare";
    if (/\bexplain\b|\binform\b|\bresearch\b|\bhow\b|\bwhy\b/.test(lower)) return "informational";
    return "response";
  }

  function rubricForType(type) {
    const rubricSets = {
      argument: [
        createSimpleRubricCriterion("Claim & Support", "States a clear opinion and supports it with relevant reasons or examples.", 4),
        createSimpleRubricCriterion("Organization", "Organises ideas logically so the opinion is easy to follow from start to finish.", 4),
        createSimpleRubricCriterion("Grammar & Vocabulary", "Uses grammar and word choice clearly enough to communicate the argument.", 4),
        createSimpleRubricCriterion("Mechanics", "Uses punctuation, spelling, and formatting clearly enough for the reader to follow.", 4),
      ],
      narrative: [
        createSimpleRubricCriterion("Story Development", "Builds a clear event or moment with meaningful detail.", 4),
        createSimpleRubricCriterion("Sequencing", "Orders events clearly so the reader can follow what happens.", 4),
        createSimpleRubricCriterion("Grammar & Vocabulary", "Uses grammar and word choice clearly enough to tell the story.", 4),
        createSimpleRubricCriterion("Mechanics", "Uses punctuation, spelling, and formatting clearly enough for the reader to follow.", 4),
      ],
      process: [
        createSimpleRubricCriterion("Task Completion", "Explains the full process clearly so the reader can complete it.", 4),
        createSimpleRubricCriterion("Step Sequence", "Presents the steps in a logical order with clear connections.", 4),
        createSimpleRubricCriterion("Grammar & Vocabulary", "Uses grammar and word choice clearly enough to explain the process.", 4),
        createSimpleRubricCriterion("Mechanics", "Uses punctuation, spelling, and formatting clearly enough for the reader to follow.", 4),
      ],
      definition: [
        createSimpleRubricCriterion("Concept Accuracy", "Explains the concept clearly and accurately for the reader.", 4),
        createSimpleRubricCriterion("Development", "Uses explanation, examples, or clarification to make the meaning clear.", 4),
        createSimpleRubricCriterion("Grammar & Vocabulary", "Uses grammar and word choice clearly enough to explain the meaning.", 4),
        createSimpleRubricCriterion("Mechanics", "Uses punctuation, spelling, and formatting clearly enough for the reader to follow.", 4),
      ],
      compare: [
        createSimpleRubricCriterion("Comparison", "Covers both subjects and highlights meaningful similarities or differences.", 4),
        createSimpleRubricCriterion("Organization", "Groups ideas clearly so the comparison is easy to follow.", 4),
        createSimpleRubricCriterion("Grammar & Vocabulary", "Uses grammar and word choice clearly enough to compare the subjects.", 4),
        createSimpleRubricCriterion("Mechanics", "Uses punctuation, spelling, and formatting clearly enough for the reader to follow.", 4),
      ],
      informational: [
        createSimpleRubricCriterion("Content Accuracy", "Explains the topic clearly with relevant supporting detail.", 4),
        createSimpleRubricCriterion("Organization", "Organises information clearly so the explanation is easy to follow.", 4),
        createSimpleRubricCriterion("Grammar & Vocabulary", "Uses grammar and word choice clearly enough to explain the topic.", 4),
        createSimpleRubricCriterion("Mechanics", "Uses punctuation, spelling, and formatting clearly enough for the reader to follow.", 4),
      ],
      response: [
        createSimpleRubricCriterion("Task Response", "Answers the prompt clearly and stays focused on the main point.", 4),
        createSimpleRubricCriterion("Organization", "Presents ideas in a logical order that is easy for the reader to follow.", 4),
        createSimpleRubricCriterion("Grammar & Vocabulary", "Uses grammar and word choice clearly enough to communicate ideas.", 4),
        createSimpleRubricCriterion("Mechanics", "Uses punctuation, spelling, and formatting clearly enough for the reader to follow.", 4),
      ],
      other: [
        createSimpleRubricCriterion("Task Response", "Addresses the writing task clearly and appropriately.", 4),
        createSimpleRubricCriterion("Organization", "Presents ideas in a logical order that is easy for the reader to follow.", 4),
        createSimpleRubricCriterion("Grammar & Vocabulary", "Uses grammar and word choice clearly enough to communicate ideas.", 4),
        createSimpleRubricCriterion("Mechanics", "Uses punctuation, spelling, and formatting clearly enough for the reader to follow.", 4),
      ],
    };

    return rubricSets[type] || rubricSets.other;
  }

  function studentPromptForType(type, topic, languageLevel) {
    const levelIntro =
      ["A0", "A1"].includes(languageLevel)
        ? "Use very short, simple sentences."
        : languageLevel === "A2"
          ? "Write in clear, simple sentences."
          : languageLevel === "B1"
            ? "Write clearly and explain your thinking."
            : languageLevel === "B2"
              ? "Write clearly and develop your ideas with some detail."
              : "Write clearly, develop your ideas fully, and use precise language.";

    if (type === "process") {
      return `${levelIntro} Explain how to do or make ${topic}. Describe each step clearly and in the right order.`;
    }
    if (type === "definition") {
      return `${levelIntro} Explain what ${topic} means. Give a clear definition and use at least one example to help the reader understand.`;
    }
    if (type === "compare") {
      return `${levelIntro} Compare and contrast two things related to ${topic}. Show how they are similar and how they are different.`;
    }
    if (type === "argument") {
      return `${levelIntro} Write an opinion piece about ${topic}. Say what you believe, give at least one strong reason or example, and explain why it matters.`;
    }
    if (type === "narrative") {
      return `${levelIntro} Write about a real or imagined moment connected to ${topic}. Make the event clear, include details, and show why the moment matters.`;
    }
    if (type === "informational") {
      return `${levelIntro} Explain ${topic}. Teach the reader using clear facts, examples, or details.`;
    }
    return `${levelIntro} Write a clear response about ${topic}. Stay focused and support your ideas with examples or explanation.`;
  }

  function focusForType(type, topic) {
    if (type === "process") {
      return [
        `explaining each step of ${topic} clearly`,
        "putting the steps in the right order",
        "adding enough detail so someone can follow along",
        "checking that no steps are missing or confusing",
      ];
    }
    if (type === "definition") {
      return [
        `giving a clear, accurate meaning of ${topic}`,
        "using at least one example that helps the reader understand",
        "explaining any difficult words",
        "making sure the definition is complete and easy to follow",
      ];
    }
    if (type === "compare") {
      return [
        `identifying the key features of both sides of ${topic}`,
        "finding at least two clear similarities or differences",
        "organising your points so the comparison is easy to follow",
        "checking that both sides are treated fairly",
      ];
    }
    if (type === "argument") {
      return [
        `a clear opinion about ${topic}`,
        "one strong reason or example",
        "explaining why that example supports the opinion",
        "fixing confusing sentences before submitting",
      ];
    }
    if (type === "narrative") {
      return [
        `one clear moment about ${topic}`,
        "details that help the reader picture it",
        "a clear beginning, middle, and end",
        "fixing places that feel rushed or confusing",
      ];
    }
    if (type === "informational") {
      return [
        `a clear explanation of ${topic}`,
        "facts or examples that teach the reader",
        "explaining one idea at a time",
        "checking that the writing is easy to understand",
      ];
    }
    return [
      `answering the question about ${topic}`,
      "using at least one helpful example",
      "explaining your thinking clearly",
      "improving the draft before submitting",
    ];
  }

  function inferWordRange(brief, assignmentType) {
    const match = brief.match(/(\d{2,4})\s*(?:to|-)\s*(\d{2,4})/);
    if (match) {
      return {
        min: Number(match[1]),
        max: Number(match[2]),
      };
    }

    if (assignmentType === "narrative") {
      return { min: 300, max: 500 };
    }
    return { min: 250, max: 400 };
  }

  function buildTitleFromBrief(brief, assignmentType, topic) {
    const cleaned = trimTo(brief.replace(/\s+/g, " ").trim(), 70);
    if (cleaned) {
      const firstSentence = cleaned.split(/[.!?]/)[0].trim();
      if (firstSentence.length > 12) {
        return titleCase(trimTo(firstSentence, 46));
      }
    }
    return `${titleCase(assignmentType)} Writing: ${titleCase(topic)}`;
  }

  function generateTeacherAssist(draft) {
    const brief = draft.brief.trim();
    const keywords = extractKeywords(brief);
    const assignmentType = detectAssignmentType(brief);
    const mainTopic = keywords[0] || "the topic";
    const title = buildTitleFromBrief(brief, assignmentType, mainTopic);
    const ranges = inferWordRange(brief, assignmentType);
    const studentFocus = focusForType(assignmentType, mainTopic);
    const totalPoints = Number(draft.totalPoints || 20);
    const baseRubric = rubricForType(assignmentType);
    const pointsEach = Math.floor(totalPoints / baseRubric.length);
    const remainder = totalPoints - pointsEach * baseRubric.length;
    const rubric = baseRubric.map((item, i) => ({
      ...item,
      points: i === baseRubric.length - 1 ? pointsEach + remainder : pointsEach,
      bands: createScoreBandsForPoints(i === baseRubric.length - 1 ? pointsEach + remainder : pointsEach),
    }));

    return {
      title,
      prompt: studentPromptForType(assignmentType, mainTopic, draft.languageLevel),
      focus: `Keep the student focused on ${studentFocus[0].toLowerCase()}.`,
      assignmentType,
      languageLevel: draft.languageLevel,
      wordCountMin: ranges.min,
      wordCountMax: ranges.max,
      studentFocus,
      rubric,
    };
  }

  function applyAiSettingsToTeacherDraft(parsed = {}) {
    const { ui } = window.AppState;
    const allowedLevels = new Set(["A0", "A1", "A2", "B1", "B2", "C1", "C2"]);
    const inferred = inferTeacherBriefSettings(ui.teacherDraft.brief);

    if (inferred.assignmentType) {
      ui.teacherDraft.assignmentType = inferred.assignmentType;
    } else if (parsed.assignmentType) {
      ui.teacherDraft.assignmentType = parsed.assignmentType;
    }
    if (allowedLevels.has(String(inferred.languageLevel || "").trim())) {
      ui.teacherDraft.languageLevel = String(inferred.languageLevel).trim();
    } else if (allowedLevels.has(String(parsed.languageLevel || "").trim())) {
      ui.teacherDraft.languageLevel = String(parsed.languageLevel).trim();
    }
    if (Number.isFinite(Number(inferred.feedbackRequestLimit)) && Number(inferred.feedbackRequestLimit) >= 0) {
      ui.teacherDraft.feedbackRequestLimit = Number(inferred.feedbackRequestLimit);
    } else if (Number.isFinite(Number(parsed.feedbackRequestLimit)) && Number(parsed.feedbackRequestLimit) >= 0) {
      ui.teacherDraft.feedbackRequestLimit = Number(parsed.feedbackRequestLimit);
    }
    if (typeof inferred.disableChatbot === "boolean") {
      ui.teacherDraft.disableChatbot = inferred.disableChatbot;
    } else if (typeof parsed.disableChatbot === "boolean") {
      ui.teacherDraft.disableChatbot = parsed.disableChatbot;
    }
    if (ui.teacherDraft.disableChatbot) {
      ui.teacherDraft.chatTimeLimit = -1;
    } else if (Number.isFinite(Number(inferred.chatTimeLimit)) && Number(inferred.chatTimeLimit) >= 0) {
      ui.teacherDraft.chatTimeLimit = Number(inferred.chatTimeLimit);
    } else if (Number.isFinite(Number(parsed.chatTimeLimit)) && Number(parsed.chatTimeLimit) >= 0) {
      ui.teacherDraft.chatTimeLimit = Number(parsed.chatTimeLimit);
    } else if (ui.teacherDraft.disableChatbot) {
      ui.teacherDraft.chatTimeLimit = -1;
    }
    if (Number.isFinite(Number(inferred.totalPoints)) && Number(inferred.totalPoints) > 0 && !ui.teacherDraft.uploadedRubricSchema?.criteria?.length) {
      ui.teacherDraft.totalPoints = Number(inferred.totalPoints);
    } else if (Number.isFinite(Number(parsed.totalPoints)) && Number(parsed.totalPoints) > 0 && !ui.teacherDraft.uploadedRubricSchema?.criteria?.length) {
      ui.teacherDraft.totalPoints = Number(parsed.totalPoints);
    }

    const deadlineDate = String(parsed.deadlineDate || "").trim();
    const deadlineTime = String(parsed.deadlineTime || "").trim();
    if (deadlineDate) {
      ui.teacherDraft.deadline = combineDeadlineParts(deadlineDate, deadlineTime || getDeadlineTimePart(ui.teacherDraft.deadline) || "09:00");
    }
  }

  const TeacherAssist = {
    createSimpleRubricCriterion,
    detectAssignmentType,
    rubricForType,
    studentPromptForType,
    focusForType,
    inferWordRange,
    buildTitleFromBrief,
    generateTeacherAssist,
    applyAiSettingsToTeacherDraft,
  };

  if (typeof window !== "undefined") {
    window.TeacherAssist = TeacherAssist;
    Object.assign(window, TeacherAssist);
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = TeacherAssist;
  }
})();
