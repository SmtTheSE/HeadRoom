# Headroom

A React + TypeScript workplace capacity prototype with Google sign-in, personalized workload estimates, and a shared employee/manager negotiation flow.

## Start locally

Requires Node.js 22.12 or newer.

```sh
npm ci
cp .env.example .env.local
# Set the Supabase project URL and public anon/publishable key.
npm run dev
```

Open `http://127.0.0.1:5173`. Unsigned visitors can explore a read-only sample. Sign in with Google to create a durable private demo workspace. The role switcher operates on synthetic Alex/Sarah personas inside that workspace; it does not assign production employee/manager permissions to Google accounts.

## Supabase setup

1. Run each file in `supabase/migrations/` (in order) in the Supabase SQL Editor. Existing demo workspaces pick up new seed data on **Reset demo**. It creates only `hr_*` tables and `hr_*` / `headroom_*` functions, with owner-isolated row-level security. Existing unrelated project data is untouched.
2. Enable the Google provider under Authentication → Sign In / Providers, with your Google OAuth client credentials.
3. In Google Cloud, the authorized redirect URI is `https://ptdgrejkeaamfqkbxepf.supabase.co/auth/v1/callback` for this project.
4. In Supabase Authentication → URL Configuration, allow:
   - `http://127.0.0.1:5173/auth/callback`
   - `https://headroom-workplace.russet-rose-8420.chatgpt.site/auth/callback`
5. For another hosting origin, allow its exact `/auth/callback` URL too. Configure SPA fallback to `index.html` so direct routes and the OAuth callback load.

The app uses Supabase's PKCE flow. Only the public project URL and public anon key belong in `VITE_` variables. The service-role key and database password must never enter frontend source or a frontend environment variable.

An optional ignored `.env.setup` can hold `DATABASE_URL` for `npm run db:migrate`. Use the project's Session pooler connection string on IPv4-only networks. TLS certificate validation is enabled. The SQL Editor is the fallback when outbound database ports are unavailable.

## Demo

The prototype intentionally uses the fixed week of September 21, 2026, with Wednesday September 23 as its planning date, in Asia/Bangkok time.

1. Sign in with Google. Alex starts at **27 / 30h** (9h presentation with 40 of 360 step-minutes done counts as 8h remaining).
2. Review My Tasks and My Capacity to see subtasks and historical learning.
3. A **Potential New Task** notification from Microsoft Teams sits at the top of the overview. Expand it to read the message, then click ✓ to confirm it is a task. Workload becomes **34 / 30h**. (✕ removes it as not a task.)
4. Choose **Resolve workload → Move Analytics Report to next Monday**.
5. Edit the message if desired and send it to Sarah. Workload stays at 34h while pending.
6. Switch to **Manager** and open Alex's request.
7. Approve; both views now show **28 / 30h**. Next week includes the shifted 6h.
8. Use **Reset demo** to repeat with counter-proposal, decline, scope reduction, or reassignment.

The app supports updates across tabs with a Realtime workspace-version subscription, refetch on focus/role switch, and a 20-second fallback refresh. The fixed scenario resets only the signed-in user's synthetic data.

## What is implemented

- Google OAuth, session restoration, sign-out, and per-user demo workspace isolation.
- Employee overview, filtered tasks, subtasks, actual hours, and completion.
- Category estimate learning with global fallback and transparent capacity breakdown.
- Manager overview and employee detail showing confirmed work information.
- Persistent requests with editable messages, counter-proposals, acceptance, decline, cancellation, and revision history.
- Deadline, scope, and reassignment previews; server-validated transactional approval.
- Stale version detection, duplicate approval protection, and cross-tab refresh.
- Keyboard-friendly native dialogs, visible focus, responsive layouts, loading and error states.

## AI breakdown

Tasks without steps show an **AI breakdown** button (task list and task detail). A real Gemini call generates 3–8 task-specific steps using the saved title, description, category, and personalized estimate. Structured JSON is validated and step durations are allocated to the existing time budget. The app stores the steps through `headroom_breakdown()`, which validates ownership and workspace versions. Provider failures show an error; there is no silent preset fallback.

### Local testing without Supabase dashboard access

1. Copy `config/ai.env.example` to `.env.server.local` in the project root.
2. Create your own [Gemini API key](https://aistudio.google.com/apikey), set `GEMINI_API_KEY` in that ignored file, and save. Never put it in a `VITE_` variable.
3. Run `npm run dev` and open `http://127.0.0.1:5173/ai-playground`. **Generate with Gemini** makes a real call without signing in or writing to the database. **Simulate a test response** is explicitly labeled test data and is confined to this playground.
4. For the integrated flow, sign in to the local app, open My Tasks, and select AI breakdown on an eligible task. The local server validates your Supabase session and loads the saved task before calling Gemini. Existing migrations, including `002_breakdown.sql`, must already be installed to save results.

The key stays in the local server. Configuration is reread for every request. The local endpoints accept only the loopback app origin and are excluded from production builds. The Gemini request includes task context each time; it does not depend on this development chat's history.

The default model is `gemini-3.1-flash-lite`. Its [free tier](https://ai.google.dev/gemini-api/docs/pricing) has quotas, and free-tier content may be used to improve Google's products: use synthetic competition tasks. Describe this feature as powered by Gemini. A paid plan is not required for eligible free-tier usage.

### Hosted app

The project owner must set `GEMINI_API_KEY` under Supabase Edge Functions → Secrets, then deploy:

```sh
supabase functions deploy breakdown
```

Optionally set `GEMINI_MODEL` to another compatible model. The hosted app calls this Edge Function; local configuration does not activate the hosted version. Its prompt treats task text as data, requests concrete ordered actions and observable outputs, and forbids invented requirements. Authentication, owner-isolated task loading, stale-version checks, and an instance-local rate limit run before generation. The rate limit is best-effort; a public production launch should add a shared quota store.

## Focus mode

Designed for ADHD: **Start** on any step opens a distraction-free page with only that step — no sidebar, no inbox, no upcoming work. A timer runs in 25-minute blocks, so a 2-hour step reads as "Block 1 of 5 · 12:04 / 25:00"; block ends and overruns are noted calmly, never in red. Pause/Resume and the elapsed time survive a refresh. **Done** records the step and shows a completion screen with the next step ready to start; **Skip to next** moves on without judgement. Elsewhere, ticking a step confirms what was done and names the next step, and due dates read as "Today", "Tomorrow", or the weekday.

## Accessibility

Headroom targets WCAG 2.2 AA and is designed for people with ADHD first: one column per page, one clear next action, small time-boxed steps, plain language, and no decorative motion.

Audit (22 Sep 2026, axe-core 4.x, WCAG 2.x A/AA + best-practice rules, all 10 routes including dialogs): **0 violations**. Manual checks passed: full keyboard operation, focus returns to the opening control after every dialog, skip link, per-page titles, 320 px reflow with no horizontal scroll, 200 % zoom, `prefers-reduced-motion`, and Windows High Contrast (`forced-colors`).

**Display preferences** (the *Display* button in the sidebar, on the sign-in page, and in focus mode) let each person adjust the interface for themselves, instantly and per browser: **Motion** (system / reduce / allow — the OS setting is respected by default and can be overridden either way), **Text size** (default / large / larger — the whole interface scales and reflows), **High contrast** (black text, solid borders, no tinted backgrounds), and **Simplified view** (only today’s focus and capacity; upcoming work, explanations, and the Teams inbox collapse). Every change is announced to screen readers.

What is implemented:

- Semantic landmarks, per-route `document.title`, and a "Skip to content" link.
- Native `<dialog>` modals labelled by their heading; focus moves in on open and back to the trigger on close; Escape closes.
- Toggle and filter controls expose `aria-pressed`; the proposal chooser is a real radio group with arrow-key navigation; the Teams inbox uses `aria-expanded` and named confirm/remove actions.
- Live regions for status; error messages persist until dismissed, success messages time out.
- Reversible actions (ticking a step, logging hours, removing a potential task) offer **Undo** in the notification instead of asking first; irreversible ones (complete task, decline or cancel a request, reset) ask for confirmation in a dialog that names the consequence.
- All text and status colours meet 4.5:1; status is never conveyed by colour alone; focus rings are 2 px ink.
- Font sizes in `rem`, so browser text-size preferences apply; layout reflows to 320 px.
- Decorative separators and icons are hidden from assistive technology.

## Calculation rules

Task estimates use a personal calibration multiplier: the **median** actual/estimated ratio of up to 10 recent records in the task's category when at least 3 exist, otherwise the employee's latest 10 valid records, otherwise 1.0. The multiplier is clamped to 0.5–3.0 and, with fewer than 3 samples, blended toward 1.0 (so one early overrun cannot dominate). Estimates are fixed when a task is activated; learning changes future estimates, not existing commitments. When AI breakdown creates steps, the steps become the estimate: personalized hours equal the step minutes.

Weekly workload sums the **remaining effort** of active tasks due that week plus overdue carryover. Progress comes from completed step minutes or logged hours, whichever is further along; completing the whole task removes it. This is due-date-bucket planning of remaining work, not an hour-by-hour schedule.

Capacity is configured, not clinically inferred. Available <70%; On track 70–<90%; Near capacity 90–100%; Over capacity >100%. Scope reductions can offer partial relief without resolving the conflict. Reassignment uses the recipient's own estimate multiplier and checks capacity.

## Verification

```sh
npm test
npm run test:db
npm run build
```

`test:db` runs the real SQL migration and RPCs in an isolated PGlite PostgreSQL instance, including RLS and transactional workflows. It does not modify the remote project.

`npm run test:live` is an optional live integration check requiring `SUPABASE_SERVICE_ROLE_KEY` in the ignored `.env.setup`. It creates one temporary email/password QA user without sending email, runs the database flow, and removes that user and its synthetic workspace in a cleanup block. It never impersonates a real account. Actual Google consent and redirect completion still require a human browser sign-in.

The only AI feature is the optional step breakdown above. No meeting extraction, email/calendar access, messaging integrations, production role administration, or health-data storage is included; the Teams notification is a scripted demo.
