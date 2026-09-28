// Injected on demand (via chrome.scripting.executeScript) when the user
// clicks "Fill this page" in the popup. Guard against double-injection.
if (!window.__jobAutofillInjected) {
  window.__jobAutofillInjected = true;

  // Ordered most-specific-first: "first name" must be checked before "name".
  const FIELD_RULES = [
    { key: "email", keywords: ["email", "e-mail"] },
    { key: "firstName", keywords: ["first name", "given name", "fname", "forename"] },
    { key: "lastName", keywords: ["last name", "surname", "family name", "lname"] },
    { key: "linkedin", keywords: ["linkedin"] },
    { key: "github", keywords: ["github"] },
    { key: "portfolio", keywords: ["portfolio", "website", "personal site"] },
    { key: "phone", keywords: ["phone", "mobile", "telephone", "contact number", "cell"] },
    { key: "addressLine", keywords: ["street address", "address line", "address"] },
    { key: "city", keywords: ["city", "town"] },
    { key: "state", keywords: ["state", "province", "region"] },
    { key: "zip", keywords: ["zip", "postal"] },
    { key: "country", keywords: ["country", "nation"] },
    { key: "currentTitle", keywords: ["current title", "job title", "position title", "role"] },
    { key: "currentCompany", keywords: ["current company", "current employer", "employer", "company name"] },
    { key: "yearsExperience", keywords: ["years of experience", "total experience", "experience (years)"] },
    { key: "degree", keywords: ["degree", "qualification"] },
    { key: "school", keywords: ["school", "university", "college", "institution"] },
    { key: "gradYear", keywords: ["graduation year", "grad year", "year of graduation"] },
    { key: "veteranStatus", keywords: ["veteran"] },
    { key: "disabilityStatus", keywords: ["disability"] },
    { key: "gender", keywords: ["gender", "sex"] },
    { key: "race", keywords: ["race", "ethnicity"] },
    { key: "currentCTC", keywords: ["current ctc", "current salary", "current compensation", "present salary", "current pay"] },
    { key: "expectedCTC", keywords: ["expected ctc", "expected salary", "expected compensation", "desired salary", "salary expectation", "expected pay"] },
    { key: "intro", keywords: ["introduce yourself", "tell us about yourself", "about yourself", "brief introduction", "introduction"] },
    { key: "fullName", keywords: ["full name", "your name", "applicant name", "name"] },
  ];

  const MAX_AI_CANDIDATES = 40;

  function normalize(text) {
    return (text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }

  function getFieldText(el) {
    const parts = [];
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) parts.push(label.innerText);
    }
    const wrappingLabel = el.closest("label");
    if (wrappingLabel) parts.push(wrappingLabel.innerText);
    if (el.getAttribute("aria-label")) parts.push(el.getAttribute("aria-label"));
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach((id) => {
        const labelEl = document.getElementById(id);
        if (labelEl) parts.push(labelEl.innerText);
      });
    }
    if (el.placeholder) parts.push(el.placeholder);
    if (el.name) parts.push(el.name);
    if (el.id) parts.push(el.id);
    return normalize(parts.join(" "));
  }

  function rawFieldLabel(el) {
    // Human-readable (non-normalized) version, used when sending context to the AI.
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label && label.innerText.trim()) return label.innerText.trim();
    }
    const wrappingLabel = el.closest("label");
    if (wrappingLabel && wrappingLabel.innerText.trim()) return wrappingLabel.innerText.trim();
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label");
    if (el.placeholder) return el.placeholder;
    return el.name || el.id || "";
  }

  function matchKey(fieldText) {
    for (const rule of FIELD_RULES) {
      if (rule.keywords.some((kw) => fieldText.includes(kw))) return rule.key;
    }
    return null;
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function highlight(el, ok) {
    const prevOutline = el.style.outline;
    el.style.outline = ok ? "2px solid #2f6f4e" : "2px solid #c98f00";
    setTimeout(() => { el.style.outline = prevOutline; }, 1500);
  }

  function fillSelect(el, value) {
    const target = normalize(value);
    for (const opt of el.options) {
      const optText = normalize(opt.textContent) + " " + normalize(opt.value);
      if (target && optText.includes(target)) {
        setNativeValue(el, opt.value);
        return true;
      }
    }
    return false;
  }

  function fillRadioOrCheckboxGroup(name, value) {
    const target = normalize(value);
    if (!target) return false;
    const group = document.querySelectorAll(
      `input[type="radio"][name="${CSS.escape(name)}"], input[type="checkbox"][name="${CSS.escape(name)}"]`
    );
    for (const input of group) {
      const text = getFieldText(input) + " " + normalize(input.value);
      if (text.includes(target)) {
        input.checked = true;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  // ---- Phase 1: fast, free, deterministic keyword matching ----
  function ruleBasedFill(profile) {
    const filled = [];
    const skippedFiles = [];
    const alreadyFilled = [];
    const handledRadioNames = new Set();
    const unmatched = []; // { el, kind: 'text'|'select'|'radio', name?, options? }

    const fields = Array.from(document.querySelectorAll("input, textarea, select"));

    for (const el of fields) {
      const type = (el.type || "").toLowerCase();
      if (type === "hidden" || type === "submit" || type === "button" || el.disabled || el.readOnly) continue;

      if (type === "file") {
        skippedFiles.push(rawFieldLabel(el) || "resume/file upload");
        continue;
      }

      if (type === "radio" || type === "checkbox") {
        if (!el.name || handledRadioNames.has(el.name)) continue;
        handledRadioNames.add(el.name);

        const optionEls = document.querySelectorAll(
          `input[type="radio"][name="${CSS.escape(el.name)}"], input[type="checkbox"][name="${CSS.escape(el.name)}"]`
        );
        const alreadyChecked = Array.from(optionEls).some((o) => o.checked);
        if (alreadyChecked) {
          alreadyFilled.push(rawFieldLabel(el) || el.name);
          continue;
        }

        const fieldText = getFieldText(el) + " " + normalize(el.name);
        const key = matchKey(fieldText);
        if (key && profile[key]) {
          if (fillRadioOrCheckboxGroup(el.name, profile[key])) {
            filled.push(key);
            continue;
          }
        }
        const options = Array.from(new Set(Array.from(optionEls).map((o) => rawFieldLabel(o) || o.value)));
        unmatched.push({ kind: "radio", name: el.name, label: rawFieldLabel(el) || el.name, options });
        continue;
      }

      // Text/textarea/select fields that already carry a value are left alone —
      // don't overwrite something the site defaulted or the user already typed.
      if (el.value && el.value.trim() !== "") {
        alreadyFilled.push(rawFieldLabel(el) || el.name || el.id);
        continue;
      }

      const fieldText = getFieldText(el);
      const key = matchKey(fieldText);

      if (key && profile[key]) {
        if (el.tagName === "SELECT") {
          if (fillSelect(el, profile[key])) {
            filled.push(key);
            highlight(el, true);
            continue;
          }
        } else {
          setNativeValue(el, profile[key]);
          filled.push(key);
          highlight(el, true);
          continue;
        }
      }

      // Not matched (or matched key but profile has no value for it) — candidate for AI pass.
      if (el.tagName === "SELECT") {
        const options = Array.from(el.options).map((o) => o.textContent.trim()).filter(Boolean);
        unmatched.push({ kind: "select", el, label: rawFieldLabel(el), options });
      } else {
        unmatched.push({ kind: "text", el, label: rawFieldLabel(el) });
      }
    }

    return { filled, skippedFiles, alreadyFilled, unmatched, totalScanned: fields.length };
  }

  // ---- Phase 2: send leftover fields + profile to the Gemini API via the background worker ----
  async function aiFill(unmatched, profile, aiSettings) {
    const candidates = unmatched.slice(0, MAX_AI_CANDIDATES);
    const fieldsPayload = candidates.map((c, index) => ({
      index,
      label: c.label,
      type: c.kind,
      options: c.options && c.options.length ? c.options : undefined,
    }));

    const response = await chrome.runtime.sendMessage({
      type: "AI_MATCH",
      apiKey: aiSettings.geminiApiKey,
      model: aiSettings.geminiModel,
      profile,
      fields: fieldsPayload,
      pageContext: `${document.title} — ${location.hostname}`,
    });

    if (!response || !response.ok) {
      return { aiFilled: 0, aiError: response ? response.error : "No response from background worker." };
    }

    let aiFilled = 0;
    for (const answer of response.answers) {
      const candidate = candidates[answer.index];
      if (!candidate || answer.value === null || answer.value === undefined || answer.value === "") continue;

      if (candidate.kind === "radio") {
        if (fillRadioOrCheckboxGroup(candidate.name, answer.value)) aiFilled++;
      } else if (candidate.kind === "select") {
        if (fillSelect(candidate.el, answer.value)) {
          aiFilled++;
          highlight(candidate.el, true);
        }
      } else {
        setNativeValue(candidate.el, answer.value);
        aiFilled++;
        highlight(candidate.el, true);
      }
    }

    return { aiFilled, aiError: null };
  }

  async function autofill(profile, aiSettings) {
    const { filled, skippedFiles, alreadyFilled, unmatched, totalScanned } = ruleBasedFill(profile);

    let aiFilled = 0;
    let aiError = null;
    if (aiSettings && aiSettings.aiEnabled && aiSettings.geminiApiKey && unmatched.length) {
      const result = await aiFill(unmatched, profile, aiSettings);
      aiFilled = result.aiFilled;
      aiError = result.aiError;
    }

    return { filled, skippedFiles, alreadyFilled, totalScanned, aiFilled, aiError, aiCandidateCount: unmatched.length };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "AUTOFILL_PAGE") {
      autofill(message.profile || {}, message.aiSettings || {})
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true; // async response
    }
  });
}