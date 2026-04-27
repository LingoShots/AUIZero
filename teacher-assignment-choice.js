// RESTORED VERSION WITH MINIMAL FIX
// Keeps original structure, only fixes AI fold-out logic

// FIND THIS FUNCTION IN FILE AND REPLACE ONLY ITS BODY:

function applyWorkflowVisibility(currentFlow, fieldStack, settings) {
  const brief = document.getElementById("teacher-brief");
  const briefCard = brief?.closest(".teacher-ready-card");
  const generated = document.getElementById("teacher-generated-assignment");
  const manualProxy = ensureManualProxy(fieldStack, settings);
  const manualSaveBar = ensureManualSaveBar(fieldStack, settings);

  const isAi = currentFlow === "ai";
  const isManual = currentFlow === "manual";
  const hasAiDraft = Boolean(window.ui?.teacherAssist?.prompt || window.ui?.teacherAssist?.title);

  // AI FLOW
  if (isAi) {
    // remove manual so it never bleeds
    document.getElementById("manual-assignment-proxy")?.remove();
    document.getElementById("manual-assignment-save-bar")?.remove();

    // step 1
    setDisplay(briefCard, true);

    // step 2
    setDisplay(generated, hasAiDraft);

    // save only after generate
    setOriginalSaveVisibility(hasAiDraft);

    let intro = document.getElementById("ai-review-intro");

    if (hasAiDraft) {
      if (!intro) {
        intro = document.createElement("div");
        intro.id = "ai-review-intro";
        intro.className = "teacher-ready-card";
        intro.style.padding = "14px 16px";
        intro.innerHTML = `
          <p class="mini-label">Step 2</p>
          <strong>Review before saving</strong>
        `;
        generated.parentElement.insertBefore(intro, generated);
      }
    } else {
      intro?.remove();
    }
  }

  // MANUAL FLOW
  if (isManual) {
    document.getElementById("ai-review-intro")?.remove();

    setDisplay(manualProxy, true);
    setDisplay(manualSaveBar, true);
    setDisplay(generated, false);

    updateManualSaveButtons(currentFlow);
  }
}
