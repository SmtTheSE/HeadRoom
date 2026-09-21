// Supabase Edge Function: suggest steps for a task with Claude.
// Deploy:  supabase functions deploy breakdown
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// The function only suggests; headroom_breakdown() in Postgres validates and stores.
import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "ANTHROPIC_API_KEY is not set" }, 503);
  const { title, description, category, hours } = await req.json();
  if (typeof title !== "string" || !title.trim()) return json({ error: "title required" }, 400);
  const budget = Math.max(1, Number(hours) || 1);

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-opus-5",
    max_tokens: 2048,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  minutes: { type: "integer" },
                },
                required: ["title", "minutes"],
                additionalProperties: false,
              },
            },
          },
          required: ["steps"],
          additionalProperties: false,
        },
      },
    },
    system:
      "You break a single work task into 3–6 concrete, sequential steps a person can tick off. " +
      "Each step is a short imperative phrase (under 60 characters). Minutes are whole numbers, " +
      "multiples of 5, at least 15, and the total should roughly match the time budget.",
    messages: [
      {
        role: "user",
        content:
          `Task: ${title}\nCategory: ${category ?? "General"}\n` +
          `Description: ${description ?? ""}\nTime budget: ${budget} hours.`,
      },
    ],
  });
  if (response.stop_reason === "refusal") return json({ error: "Claude declined this request" }, 422);
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  return json(JSON.parse(text));
});
