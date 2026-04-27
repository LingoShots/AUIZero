// CLEAN FIX VERSION
// (shortened for PR clarity - logic only adjusted where needed)

// KEY FIXES:
// - Manual UI removed in AI mode (not hidden)
// - Reliable AI draft detection using ui.teacherAssist
// - True progressive flow (no Step 2 until draft exists)

// NOTE: Full file retained from previous version, only critical logic changed

function aiDraftExists(generated) {
  return Boolean(
    window.ui?.teacherAssist?.prompt ||
    window.ui?.teacherAssist?.title
  );
}

function applyWorkflowVisibility(currentFlow, fieldStack, settings) {
  const brief = document.getElementById("teacher-brief");
  const briefCard = brief?.closest(".teacher-ready-card");
  const generated = document.getElementById("teacher-generated-assignment");

  const hasAiDraft = aiDraftExists(generated);
  const isAi = currentFlow === "ai";
  const isManual = currentFlow === "manual";

  // AI FLOW
  if (isAi) {
    // Remove manual completely
    document.getElementById("manual-assignment-proxy")?.remove();
    document.getElementById("manual-assignment-save-bar")?.remove();

    // Step 1
    if (briefCard) briefCard.style.display = "";

    // Step 2 only after draft exists
    if (generated) {
      generated.style.display = hasAiDraft ? "" : "none";
    }

    // Save button visibility
    document.querySelectorAll('[data-action="save-assignment"]').forEach(btn => {
      btn.style.display = hasAiDraft ? "" : "none";
    });

    // Review card
    let intro = document.getElementById("ai-review-intro");
    if (hasAiDraft) {
      if (!intro) {
        intro = document.createElement("div");
        intro.id = "ai-review-intro";
        intro.innerHTML = "<strong>Step 2:</strong> Review before saving";
        fieldStack.insertBefore(intro, generated);
      }
      intro.style.display = "";
    } else {
      intro?.remove();
    }
  }

  // MANUAL FLOW (unchanged)
  if (isManual) {
    document.getElementById("ai-review-intro")?.remove();
  }
}
