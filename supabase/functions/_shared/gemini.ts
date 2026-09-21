import {
  allocateMinutes,
  BreakdownError,
  DEFAULT_MODEL,
  INSTRUCTIONS,
  STEP_SCHEMA,
  taskContext,
  validateSteps,
  validateTask,
  type BreakdownTask,
  type BreakdownResult,
} from "./checklist.ts";
export function geminiRequest(task: BreakdownTask) {
  return {
    systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
    contents: [
      { role: "user", parts: [{ text: JSON.stringify(taskContext(task)) }] },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2000,
      responseMimeType: "application/json",
      responseJsonSchema: STEP_SCHEMA,
    },
  };
}
export async function generateWithGemini(
  input: BreakdownTask,
  options: { apiKey?: string; model?: string; fetcher?: typeof fetch },
): Promise<BreakdownResult> {
  const task = validateTask(input),
    model = options.model?.trim() || DEFAULT_MODEL;
  if (!options.apiKey?.trim())
    throw new BreakdownError(
      503,
      "Gemini is not configured. Add GEMINI_API_KEY to the server configuration to enable real AI breakdown.",
    );
  if (!/^[a-zA-Z0-9._-]+$/.test(model))
    throw new BreakdownError(503, "The Gemini model configuration is invalid.");
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": options.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(geminiRequest(task)),
        signal: AbortSignal.timeout(35000),
      },
    );
  } catch {
    throw new BreakdownError(
      504,
      "Gemini could not be reached in time. No steps were saved. Please retry.",
    );
  }
  // Never forward the provider's raw error body, prompt, or key to the browser.
  if (!response.ok) {
    console.warn("Gemini request failed", { model, status: response.status });
    if (response.status === 503)
      throw new BreakdownError(
        503,
        "Gemini is temporarily busy. No steps were saved. Please wait a moment and retry.",
      );
    if (response.status === 404)
      throw new BreakdownError(
        503,
        "The configured Gemini model is no longer available for this project. Update GEMINI_MODEL in the server configuration.",
      );
    if (response.status === 429)
      throw new BreakdownError(
        429,
        "Gemini's free-tier quota or rate limit was reached. Wait and retry, or check your AI Studio quota.",
      );
    if ([400, 401, 403].includes(response.status))
      throw new BreakdownError(
        503,
        "Gemini rejected the request. Check the server's API key, model, and project access.",
      );
    throw new BreakdownError(
      502,
      "Gemini could not generate the checklist. No steps were saved. Please retry.",
    );
  }
  let data: {
    promptFeedback?: { blockReason?: string };
    candidates?: {
      finishReason?: string;
      content?: { parts?: { text?: string; thought?: boolean }[] };
    }[];
  };
  try {
    data = await response.json();
  } catch {
    throw new BreakdownError(
      502,
      "Gemini returned an unreadable response. Please retry.",
    );
  }
  const candidate = data.candidates?.[0];
  if (
    data.promptFeedback?.blockReason ||
    ["SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST"].includes(
      candidate?.finishReason ?? "",
    )
  )
    throw new BreakdownError(
      422,
      "Gemini could not break down this task. Review its description and try again.",
    );
  if (candidate?.finishReason !== "STOP")
    throw new BreakdownError(
      502,
      "The AI response was incomplete. No steps were saved. Please retry.",
    );
  const text =
    candidate.content?.parts
      ?.filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("") ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BreakdownError(
      502,
      "The AI returned an unreadable checklist. Please retry.",
    );
  }
  const steps = allocateMinutes(validateSteps(parsed), task.personalized_hours);
  return {
    steps,
    source: "gemini",
    model,
    total_minutes: steps.reduce((n, s) => n + s.minutes, 0),
  };
}
