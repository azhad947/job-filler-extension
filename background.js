const DEFAULT_MODEL = "gemini-2.0-flash";

function buildPrompt(profile, fields, pageContext) {
  return `You are helping fill out a job application form. You are given the
applicant's profile data and a list of form fields a keyword matcher could
not confidently map on its own.

Rules:
- Only use facts present in "profile". Never invent employers, dates,
  numbers, or answers that aren't supported by the profile data.
- If a field has an "options" array (it's a select or radio/checkbox group),
  you MUST return one of those option strings exactly as given, or null.
- If a field has no options and nothing in the profile answers it (e.g. a
  very specific essay question with no relevant summary), return null.
- For salary/compensation fields, only answer if the profile clearly states
  one; otherwise null.
- Keep free-text answers short (1-3 sentences) and grounded only in
  "profile.summary" plus other profile fields — do not fabricate.
- Return STRICT JSON only, no markdown code fences, exactly this shape:
  {"answers": [{"index": 0, "value": "..."}, {"index": 1, "value": null}]}
  Include exactly one entry per field index given below, in any order.

Page context: ${pageContext || "(unknown page)"}

Profile:
${JSON.stringify(profile)}

Fields:
${JSON.stringify(fields)}`;
}

async function handleAiMatch({ apiKey, model, profile, fields, pageContext }) {
  if (!apiKey) return { ok: false, error: "No Gemini API key saved." };
  if (!fields || fields.length === 0) return { ok: true, answers: [] };

  const prompt = buildPrompt(profile, fields, pageContext);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model || DEFAULT_MODEL
  )}:generateContent`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }),
    });
  } catch (err) {
    return { ok: false, error: `Network error calling Gemini: ${err.message}` };
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    return { ok: false, error: `Gemini API error ${res.status}: ${bodyText.slice(0, 300)}` };
  }

  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: "Couldn't parse Gemini's response as JSON." };
  }

  return { ok: true, answers: Array.isArray(parsed.answers) ? parsed.answers : [] };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "AI_MATCH") {
    handleAiMatch(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep the message channel open for the async response
  }
  return false;
});
