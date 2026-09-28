const FIELD_IDS = [
  "firstName", "lastName", "fullName", "email", "phone",
  "addressLine", "city", "state", "zip", "country",
  "linkedin", "github", "portfolio",
  "currentTitle", "currentCompany", "yearsExperience", "currentCTC", "expectedCTC",
  "degree", "school", "gradYear",
  "gender", "race", "veteranStatus", "disabilityStatus",
  "intro", "summary",
];

const AI_FIELD_IDS = ["aiEnabled", "geminiApiKey", "geminiModel"];

const statusEl = document.getElementById("status");
const form = document.getElementById("profileForm");
const lastSavedEl = document.getElementById("lastSaved");

function showStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.hidden = false;
  statusEl.classList.toggle("error", isError);
}

async function loadProfile() {
  const { profile, savedAt, aiSettings } = await chrome.storage.local.get(["profile", "savedAt", "aiSettings"]);
  if (profile) {
    FIELD_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el && profile[id]) el.value = profile[id];
    });
  }
  if (aiSettings) {
    document.getElementById("aiEnabled").checked = !!aiSettings.aiEnabled;
    if (aiSettings.geminiApiKey) document.getElementById("geminiApiKey").value = aiSettings.geminiApiKey;
    if (aiSettings.geminiModel) document.getElementById("geminiModel").value = aiSettings.geminiModel;
  }
  if (savedAt) {
    lastSavedEl.textContent = `Saved ${new Date(savedAt).toLocaleString()}`;
  }
}

async function saveProfile(e) {
  e.preventDefault();
  const profile = {};
  FIELD_IDS.forEach((id) => {
    const el = document.getElementById(id);
    profile[id] = el ? el.value.trim() : "";
  });
  const aiSettings = {
    aiEnabled: document.getElementById("aiEnabled").checked,
    geminiApiKey: document.getElementById("geminiApiKey").value.trim(),
    geminiModel: document.getElementById("geminiModel").value.trim(),
  };
  const savedAt = Date.now();
  await chrome.storage.local.set({ profile, aiSettings, savedAt });
  showStatus("Profile saved.");
  lastSavedEl.textContent = `Saved ${new Date(savedAt).toLocaleString()}`;
}

async function fillCurrentPage() {
  showStatus("Filling form…");
  const { profile, aiSettings } = await chrome.storage.local.get(["profile", "aiSettings"]);
  if (!profile) {
    showStatus("Save your profile first.", true);
    return;
  }
  if (aiSettings && aiSettings.aiEnabled && !aiSettings.geminiApiKey) {
    showStatus("AI fill is on but no Gemini API key is saved — add one or turn AI fill off.", true);
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    showStatus("No active tab found.", true);
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });

    chrome.tabs.sendMessage(tab.id, { type: "AUTOFILL_PAGE", profile, aiSettings: aiSettings || {} }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus(`Couldn't run on this page: ${chrome.runtime.lastError.message}`, true);
        return;
      }
      if (!response || !response.ok) {
        showStatus("No fillable fields matched on this page.", true);
        return;
      }
      const { filled, skippedFiles, alreadyFilled, aiFilled, aiError, aiCandidateCount } = response;
      const totalFilled = filled.length + (aiFilled || 0);
      let msg = totalFilled
        ? `Filled ${totalFilled} field${totalFilled === 1 ? "" : "s"}`
        : "No matching fields found on this page.";
      if (aiFilled) msg += ` (${aiFilled} via AI)`;
      if (totalFilled) msg += ".";
      if (skippedFiles.length) {
        msg += ` ${skippedFiles.length} file upload field${skippedFiles.length === 1 ? "" : "s"} need manual attachment.`;
      }
      if (alreadyFilled && alreadyFilled.length) {
        msg += ` ${alreadyFilled.length} field${alreadyFilled.length === 1 ? " was" : "s were"} already filled and left as-is.`;
      }
      if (aiError) {
        msg += ` AI fill error: ${aiError}`;
      } else if (aiSettings && aiSettings.aiEnabled && aiCandidateCount === 0) {
        msg += " (everything was matched by rules — no AI call needed).";
      }
      showStatus(msg, totalFilled === 0);
    });
  } catch (err) {
    showStatus(`Couldn't run on this page (${err.message}). Some browser pages block extensions.`, true);
  }
}

document.getElementById("fillBtn").addEventListener("click", fillCurrentPage);
form.addEventListener("submit", saveProfile);
loadProfile();