// ONLY CHANGE: fix applyWorkflowVisibility

function applyWorkflowVisibility(currentFlow, fieldStack, settings) {
  const brief = document.getElementById("teacher-brief");
  const briefCard = brief?.closest(".teacher-ready-card");
  const generated = document.getElementById("teacher-generated-assignment");

  const hasAiDraft = Boolean(window.ui?.teacherAssist?.prompt || window.ui?.teacherAssist?.title);

  const isAi = currentFlow === "ai";
  const isManual = currentFlow === "manual";

  // ---------- AI MODE ----------
  if (isAi) {
    // REMOVE manual completely
    document.getElementById("manual-assignment-proxy")?.remove();
    document.getElementById("manual-assignment-save-bar")?.remove();

    // Step 1
    if (briefCard) briefCard.style.display = "";

    // Step 2
    if (generated) {
      generated.style.display = hasAiDraft ? "" : "none";
    }

    // Save button only after generation
    document.querySelectorAll('[data-action="save-assignment"]').forEach(btn => {
      btn.style.display = hasAiDraft ? "" : "none";
    });

    // Review card
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
      intro.style.display = "";
    } else {
      intro?.remove();
    }
  }

  // ---------- MANUAL MODE ----------
  if (isManual) {
    document.getElementById("ai-review-intro")?.remove();

    // Ensure manual UI exists
    if (!document.getElementById("manual-assignment-proxy")) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = renderManualProxyHtml().trim();
      fieldStack.insertBefore(wrapper.firstElementChild, settings);
    }

    if (!document.getElementById("manual-assignment-save-bar")) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = renderManualSaveBarHtml().trim();
      fieldStack.insertBefore(wrapper.firstElementChild, settings.nextSibling);
    }
  }
}
