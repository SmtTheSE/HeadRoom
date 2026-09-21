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

1. Run `supabase/migrations/001_headroom.sql` in the Supabase SQL Editor. It creates only `hr_*` tables and `hr_*` / `headroom_*` functions, with owner-isolated row-level security. Existing unrelated project data is untouched.
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

1. Sign in with Google. Alex starts at **28 / 30h**.
2. Review My Tasks and My Capacity to see subtasks and historical learning.
3. Click **Add demo assignment**. Workload becomes **35 / 30h**.
4. Choose **Resolve workload → Move Analytics Report to next Monday**.
5. Edit the message if desired and send it to Sarah. Workload stays at 35h while pending.
6. Switch to **Manager** and open Alex's request.
7. Approve; both views now show **29 / 30h**. Next week includes the shifted 6h.
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

## Calculation rules

Task estimates use the average actual/estimated ratio of up to 10 recent category records when at least 3 exist. Otherwise the employee's latest 10 valid records are used, falling back to 1.0. Estimates are fixed when a task is activated; learning changes future estimates, not existing commitments.

Weekly workload sums full personalized estimates of active tasks due that week plus overdue carryover. Logging hours or completing one subtask does not subtract hours. Completing the whole task removes its estimate. This is due-date-bucket planning, not an hour-by-hour schedule or a remaining-effort forecast.

Capacity is configured, not clinically inferred. Comfortable <70%; Busy 70–<90%; Near Capacity 90–100%; Capacity Conflict >100%. Scope reductions can offer partial relief without resolving the conflict. Reassignment uses the recipient's own estimate multiplier and checks capacity.

## Verification

```sh
npm test
npm run test:db
npm run build
```

`test:db` runs the real SQL migration and RPCs in an isolated PGlite PostgreSQL instance, including RLS and transactional workflows. It does not modify the remote project.

`npm run test:live` is an optional live integration check requiring `SUPABASE_SERVICE_ROLE_KEY` in the ignored `.env.setup`. It creates one temporary email/password QA user without sending email, runs the database flow, and removes that user and its synthetic workspace in a cleanup block. It never impersonates a real account. Actual Google consent and redirect completion still require a human browser sign-in.

No AI, meeting extraction, email/calendar access, messaging integrations, production role administration, or health-data storage is included.
