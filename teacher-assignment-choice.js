(()=>{const FLOW_STORAGE_KEY="praxis-assignment-creation-flow";let enhanceScheduled=!1,isEnhancing=!1;function getFlow(){try{return window.sessionStorage.getItem(FLOW_STORAGE_KEY)||"ai"}catch{return"ai"}}function setFlow(t){try{window.sessionStorage.setItem(FLOW_STORAGE_KEY,t)}catch{}}function setDisplay(t,e){t&&(t.style.display=e?"":"none")}function workflowCard(t,e,n,o,a){const i=t===e;return`
      <div data-assignment-flow-card="${t}" style="
        border:1px solid ${i?"var(--accent)":"var(--line)"};
        background:${i?"#fffaf0":"#fff"};
        border-radius:16px;
        padding:16px;
        box-shadow:${i?"0 8px 22px rgba(185, 130, 55, 0.12)":"none"};
        display:flex;
        flex-direction:column;
        gap:12px;
        min-height:178px;
      ">
        <div>
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:8px;">
            <h3 style="font-size:1rem;margin:0;color:var(--ink);">${n}</h3>
            ${i?`<span class="pill" style="color:var(--accent-deep);border-color:var(--accent);">Selected</span>`:""}
          </div>
          <p class="subtle" style="margin:0;line-height:1.5;">${o}</p>
        </div>
        <button class="${i?"button":"button-secondary"}" type="button" data-assignment-flow-choice="${t}" style="margin-top:auto;width:100%;">
          ${a}
        </button>
      </div>
    `}function renderChoiceHtml(t){return`
      <div id="assignment-workflow-choice" data-current-flow="${t}" class="teacher-ready-card" style="padding:16px;border-color:var(--line);background:#fffefb;">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:14px;">
          <div>
            <p class="mini-label" style="margin-bottom:4px;">Create assignment</p>
            <h3 style="font-size:1.08rem;margin:0 0 5px;color:var(--ink);">How would you like to start?</h3>
            <p class="subtle" style="margin:0;max-width:620px;">Choose AI-assisted setup or manual setup.</p>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;">
          ${workflowCard("ai",t,"Create with AI support","Add a rough brief, let Praxis create a student-ready version.","Use AI-assisted setup")}
          ${workflowCard("manual",t,"Set up manually","Write the student title and instructions yourself.","Use manual setup")}
        </div>
      </div>
    `}function renderManualProxyHtml(){return`
      <div id="manual-assignment-proxy" class="teacher-ready-card" style="padding:16px;border-color:var(--line);background:#fff;">
        <p class="mini-label" style="margin-bottom:4px;">Manual assignment setup</p>
        <h3 style="font-size:1.05rem;margin:0 0 6px;color:var(--ink);">Write the student-facing task</h3>
        <label>Assignment title</label>
        <input id="manual-assignment-title" />
        <label>Student instructions</label>
        <textarea id="manual-assignment-prompt"></textarea>
      </div>
    `}function renderManualSaveBarHtml(){return`
      <div id="manual-assignment-save-bar" class="teacher-ready-card">
        <button class="button" type="button" data-manual-settings-save="true" disabled>Save assignment</button>
      </div>
    `}function relabelTeacherButtons(){document.querySelectorAll('[data-action="save-assignment"]').forEach(t=>{(t.textContent||"").trim()==="Save"&&(t.textContent="Save assignment")})}function getManualProxyValues(){return{title:document.getElementById("manual-assignment-title")?.value?.trim()||"",prompt:document.getElementById("manual-assignment-prompt")?.value?.trim()||""}}function manualReady(){const t=getManualProxyValues();return!!(t.title&&t.prompt)}function syncManual(){const t=document.getElementById("teacher-title"),e=document.getElementById("teacher-prompt"),{title:n,prompt:o}=getManualProxyValues();t&&(t.value=n),e&&(e.value=o)}function updateManualSaveButtons(t){if("manual"!==t)return;const e=manualReady();document.querySelectorAll('[data-action="save-assignment"],[data-manual-settings-save]').forEach(t=>{t.disabled=!e})}function ensureManualProxy(t,e){let n=document.getElementById("manual-assignment-proxy");if(!n){const o=document.createElement("div");o.innerHTML=renderManualProxyHtml().trim(),n=o.firstElementChild,t.insertBefore(n,e)}return n}function ensureManualSaveBar(t,e){let n=document.getElementById("manual-assignment-save-bar");if(!n){const o=document.createElement("div");o.innerHTML=renderManualSaveBarHtml().trim(),n=o.firstElementChild}return t.insertBefore(n,e.nextSibling),n}function originalSaveButtons(){return Array.from(document.querySelectorAll('[data-action="save-assignment"]')).filter(t=>!t.matches("[data-manual-settings-save]"))}function setOriginalSaveVisibility(t){originalSaveButtons().forEach(e=>{e.style.display=t?"":"none"})}function applyWorkflowVisibility(t,e,n){const o=document.getElementById("teacher-generated-assignment"),a=ensureManualProxy(e,n),i=ensureManualSaveBar(e,n);setDisplay(a,"manual"===t),setDisplay(i,"manual"===t),o&&setDisplay(o,"ai"===t),setOriginalSaveVisibility("ai"===t),updateManualSaveButtons(t)}function enhance(){if(isEnhancing)return;isEnhancing=!0;try{const t=document.getElementById("teacher-rubric-upload"),e=document.getElementById("teacher-shared-settings"),n=document.getElementById("teacher-generated-assignment");if(!t||!e||!n)return;const o=t.parentElement;let a=getFlow();let i=document.getElementById("assignment-workflow-choice");i||(i=document.createElement("div"),i.innerHTML=renderChoiceHtml(a).trim(),o.insertBefore(i,t)),applyWorkflowVisibility(a,o,e),relabelTeacherButtons()}finally{isEnhancing=!1}}document.addEventListener("click",async t=>{const e=t.target.closest("[data-assignment-flow-choice]");if(e){setFlow(e.dataset.assignmentFlowChoice),enhance();return}const n=t.target.closest("[data-manual-settings-save]");n&&(t.preventDefault(),t.stopPropagation(),syncManual(),await window.saveCurrentTeacherAssignment())}),window.addEventListener("DOMContentLoaded",enhance)})();