import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Gauge,
  LayoutDashboard,
  ListTodo,
  LoaderCircle,
  LogOut,
  MessageSquare,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import {
  action,
  breakdown as saveBreakdown,
  loadState,
  supabase,
} from "./data";
import { generateSteps } from "./breakdown";
import { previewState } from "./seed";
import {
  active,
  applyPreview,
  due,
  hours,
  multiplier,
  person,
  recommendations,
  risk,
  status,
  workload,
  WEEK_END,
} from "./domain";
import type { AppState, Negotiation, Proposal, Role, Task } from "./types";

type Run = (op: string, payload?: Record<string, unknown>) => Promise<boolean>;
type Breakdown = (task: Task) => Promise<boolean>;
function Badge({ load, capacity }: { load: number; capacity: number }) {
  const s = status(load, capacity);
  return <span className={`badge ${s.tone}`}>{s.label}</span>;
}
/** Structured description of a proposal: which task, what changes, from → to. */
function describeProposal(state: AppState, p: Proposal) {
  const task = state.tasks.find((t) => t.id === p.task_id);
  const title = task?.title ?? "Task";
  if (!task) return { title, change: "Adjustment", from: "", to: p.label };
  if (p.type === "deadline")
    return {
      title,
      change: "Deadline",
      from: due(task.deadline, true),
      to: due(p.deadline!, true),
    };
  if (p.type === "scope")
    return {
      title,
      change: "Scope",
      from: `${hours(task.personalized_hours)}h`,
      to: `${hours(Math.max(0, task.personalized_hours - p.scope_hours!))}h`,
    };
  return {
    title,
    change: "Assignee",
    from: person(state, task.employee_id).name.split(" ")[0],
    to: person(state, p.employee_id!).name.split(" ")[0],
  };
}
function proposalTitle(state: AppState, p: Proposal) {
  const d = describeProposal(state, p);
  return `${d.title} · ${d.change}: ${d.from} → ${d.to}`;
}
function ProposalTitle({
  state,
  proposal,
}: {
  state: AppState;
  proposal: Proposal;
}) {
  const d = describeProposal(state, proposal);
  return (
    <span className="proposal-title">
      <strong>{d.title}</strong>
      <span>
        {d.change}: <s>{d.from}</s>
        <ArrowRight size={13} aria-label="to" />
        <b>{d.to}</b>
      </span>
    </span>
  );
}
function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          aria-pressed={value === o}
          className={value === o ? "selected" : ""}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
function Avatar({
  name,
  large = false,
  src,
}: {
  name: string;
  large?: boolean;
  src?: string;
}) {
  if (src)
    return (
      <img
        className={`avatar ${large ? "large" : ""}`}
        src={src}
        alt=""
        referrerPolicy="no-referrer"
      />
    );
  return (
    <span
      className={`avatar ${large ? "large" : ""} avatar-${name.split(" ")[0].toLowerCase()}`}
    >
      {name
        .split(" ")
        .map((x) => x[0])
        .join("")}
    </span>
  );
}
function Progress({
  load,
  capacity,
  dark = false,
}: {
  load: number;
  capacity: number;
  dark?: boolean;
}) {
  return (
    <div
      className={`progress ${dark ? "on-dark" : ""}`}
      role="meter"
      aria-label="Weekly capacity used"
      aria-valuemin={0}
      aria-valuemax={Math.max(capacity, load)}
      aria-valuenow={load}
    >
      <span
        style={{ width: `${Math.min(100, (load / capacity) * 100)}%` }}
        className={load > capacity ? "over" : ""}
      />
    </div>
  );
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      className="modal"
      ref={ref}
      onCancel={onClose}
      onClose={onClose}
      aria-label={title}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-btn"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNoticeState] = useState<{
      text: string;
      tone: "success" | "error";
    } | null>(null),
    [resetOpen, setResetOpen] = useState(false);
  const [compose, setCompose] = useState<{
    mode: "request" | "counter" | "revise";
    request?: Negotiation;
  } | null>(null);
  const setNotice = (text: string, tone: "success" | "error" = "success") =>
    setNoticeState(text ? { text, tone } : null);
  const location = useLocation(),
    navigate = useNavigate(),
    cache = useQueryClient();
  const role: Role = location.pathname.startsWith("/manager")
    ? "manager"
    : "employee";
  useEffect(() => {
    let mounted = true;
    const authError = new URLSearchParams(window.location.search).get(
      "error_description",
    );
    if (authError) setNotice(authError, "error");
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (mounted) {
          setSession(data.session);
          setReady(true);
          if (error) setNotice(error.message, "error");
        }
      })
      .catch(() => {
        if (mounted) {
          setNotice(
            "We could not restore your sign-in. Please try again.",
            "error",
          );
          setReady(true);
        }
      });
    const { data } = supabase.auth.onAuthStateChange((_event, value) => {
      setSession(value);
      setReady(true);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (session && location.pathname === "/sign-in")
      navigate("/employee/dashboard", { replace: true });
  }, [session, location.pathname]);
  const query = useQuery({
    queryKey: ["workspace", session?.user.id],
    queryFn: loadState,
    enabled: !!session,
    refetchInterval: session ? 20000 : false,
  });
  const state = query.data ?? previewState;
  useEffect(() => {
    if (!session || !query.data) return;
    const channel = supabase
      .channel(`workspace-${query.data.workspace.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "hr_workspaces",
          filter: `id=eq.${query.data.workspace.id}`,
        },
        () => {
          void cache.invalidateQueries({ queryKey: ["workspace"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [session?.user.id, query.data?.workspace.id, cache]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 9000);
    return () => clearTimeout(timer);
  }, [notice]);
  const run: Run = async (op, payload = {}) => {
    if (!session) {
      navigate("/sign-in");
      return false;
    }
    if (!query.data) {
      setNotice(
        "Your workspace is not ready yet. Please retry loading it.",
        "error",
      );
      return false;
    }
    setBusy(true);
    try {
      const updated = await action(
        op,
        { ...payload, role },
        query.data.workspace.version,
      );
      cache.setQueryData(["workspace", session.user.id], updated);
      if (op === "reset") localStorage.removeItem(DISMISSED_KEY);
      setNotice(
        op === "request"
          ? "Your request is with Sarah."
          : op === "approve" || op === "accept"
            ? "Adjustment applied. Your shared workload is up to date."
            : op === "reset"
              ? "Your demo is ready to present again."
              : "Changes saved.",
      );
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "We could not save that. Try again.",
        "error",
      );
      void query.refetch();
      return false;
    } finally {
      setBusy(false);
    }
  };
  const runBreakdown: Breakdown = async (task) => {
    if (!session) {
      navigate("/sign-in");
      return false;
    }
    if (!query.data) {
      setNotice(
        "Your workspace is not ready yet. Please retry loading it.",
        "error",
      );
      return false;
    }
    setBusy(true);
    try {
      const { steps, source } = await generateSteps(task);
      const updated = await saveBreakdown(
        task.id,
        steps,
        query.data.workspace.version,
      );
      cache.setQueryData(["workspace", session.user.id], updated);
      setNotice(
        source === "ai"
          ? `AI breakdown added ${steps.length} steps to ${task.title}.`
          : `Added ${steps.length} suggested steps to ${task.title}. Deploy the breakdown function for AI-generated steps.`,
      );
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "We could not break that task down.",
        "error",
      );
      void query.refetch();
      return false;
    } finally {
      setBusy(false);
    }
  };
  async function signIn() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/auth/callback" },
    });
    if (error) {
      setNotice(error.message, "error");
      setBusy(false);
    }
  }
  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setNotice(error.message, "error");
      return;
    }
    cache.clear();
    setSession(null);
    navigate("/employee/dashboard");
  }
  function changeRole(next: Role) {
    navigate(`/${next}/dashboard`);
    if (session) void query.refetch();
  }
  const pending = state.negotiations.filter(
    (n) => n.status === "pending" || n.status === "counter_proposed",
  ).length;
  const p = person(state, role === "employee" ? "alex" : "sarah");
  const toast = notice && (
    <div
      className={`toast ${notice.tone}`}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      <span>{notice.text}</span>
      <button onClick={() => setNotice("")} aria-label="Dismiss message">
        <X size={16} />
      </button>
    </div>
  );
  if (location.pathname === "/sign-in")
    return (
      <>
        <SignInPage state={state} busy={busy || !ready} onGoogle={signIn} />
        {toast}
      </>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to={`/${role}/dashboard`}>
          <span className="brand-mark">
            h<span>·</span>
          </span>
          headroom<span className="brand-period">.</span>
        </Link>
        <nav aria-label="Main">
          <NavLink to={`/${role}/dashboard`}>
            <LayoutDashboard size={19} />
            {role === "employee" ? "My overview" : "Team overview"}
          </NavLink>
          {role === "employee" && (
            <>
              <NavLink to="/employee/tasks">
                <ListTodo size={19} />
                My tasks
              </NavLink>
              <NavLink to="/employee/capacity">
                <Gauge size={19} />
                My capacity
              </NavLink>
            </>
          )}
          <NavLink to={`/${role}/negotiations`}>
            <MessageSquare size={19} />
            Workload requests
            {pending > 0 && <span className="nav-count">{pending}</span>}
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          {session ? (
            <div className="profile-mini">
              <Avatar
                name={
                  session.user.user_metadata.full_name ??
                  session.user.user_metadata.name ??
                  session.user.email ??
                  "?"
                }
                src={
                  session.user.user_metadata.avatar_url ??
                  session.user.user_metadata.picture
                }
              />
              <div>
                <strong>
                  {session.user.user_metadata.full_name ??
                    session.user.user_metadata.name ??
                    session.user.email}
                </strong>
                <small>{session.user.email}</small>
                <small>
                  Viewing as {p.name} · {p.job_title}
                </small>
              </div>
              <button
                className="icon-btn"
                onClick={signOut}
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut size={17} />
              </button>
            </div>
          ) : (
            <div className="profile-mini">
              <Avatar name={p.name} />
              <div>
                <strong>{p.name}</strong>
                <small>{p.job_title} · sample</small>
              </div>
            </div>
          )}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="topbar-status">
            {session
              ? "Private demo workspace"
              : "Sample workspace · sign in to save changes"}
          </span>
          <div className="top-actions">
            <Segmented
              label="View as"
              options={["Employee", "Manager"] as const}
              value={role === "employee" ? "Employee" : "Manager"}
              onChange={(v) =>
                changeRole(v === "Employee" ? "employee" : "manager")
              }
            />
            <button
              className="btn ghost"
              aria-label="Reset demo"
              disabled={busy}
              onClick={() =>
                session ? setResetOpen(true) : navigate("/sign-in")
              }
            >
              <RotateCcw size={15} />
              <span>Reset demo</span>
            </button>
            {!session && (
              <Link className="btn primary" to="/sign-in">
                Sign in
              </Link>
            )}
          </div>
        </header>
        <main>
          {ready && session && query.isError ? (
            <div className="connection-error">
              <h1>Let’s connect your workspace</h1>
              <p>
                {query.error.message.includes("headroom_state")
                  ? "The Headroom database setup is not installed yet. Run the supplied SQL setup in your Supabase project, then retry."
                  : query.error.message}
              </p>
              <button className="btn primary" onClick={() => query.refetch()}>
                Retry connection
              </button>
            </div>
          ) : !ready || (session && query.isPending) ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              <p>Making room for your work…</p>
            </div>
          ) : (
            <Routes>
              <Route
                path="/employee/dashboard"
                element={
                  <Dashboard
                    state={state}
                    busy={busy}
                    run={run}
                    resolve={() => setCompose({ mode: "request" })}
                  />
                }
              />
              <Route
                path="/employee/tasks"
                element={
                  <TasksPage
                    state={state}
                    busy={busy}
                    onBreakdown={runBreakdown}
                  />
                }
              />
              <Route
                path="/employee/tasks/:id"
                element={
                  <TaskDetail
                    state={state}
                    busy={busy}
                    run={run}
                    onBreakdown={runBreakdown}
                  />
                }
              />
              <Route
                path="/employee/capacity"
                element={
                  <CapacityPage
                    state={state}
                    resolve={() => setCompose({ mode: "request" })}
                  />
                }
              />
              <Route
                path="/manager/dashboard"
                element={<ManagerDashboard state={state} />}
              />
              <Route
                path="/manager/employees/:id"
                element={<EmployeeDetail state={state} />}
              />
              <Route
                path="/:role/negotiations"
                element={
                  <Requests
                    state={state}
                    role={role}
                    resolve={() => setCompose({ mode: "request" })}
                  />
                }
              />
              <Route
                path="/:role/negotiations/:id"
                element={
                  <RequestDetail
                    state={state}
                    role={role}
                    busy={busy}
                    run={run}
                    compose={(mode, request) => setCompose({ mode, request })}
                  />
                }
              />
              <Route
                path="*"
                element={<Navigate to="/employee/dashboard" replace />}
              />
            </Routes>
          )}
        </main>
      </div>
      {toast}
      {resetOpen && (
        <Modal title="Start a fresh demo?" onClose={() => setResetOpen(false)}>
          <p className="muted">
            This resets your sample tasks, time entries, and requests to Alex’s
            starting workload of 28 / 30h. It only affects your synthetic
            workspace.
          </p>
          <div className="modal-actions">
            <button
              className="btn secondary"
              onClick={() => setResetOpen(false)}
            >
              Keep my changes
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                if (await run("reset")) setResetOpen(false);
              }}
            >
              Reset demo
            </button>
          </div>
        </Modal>
      )}
      {compose && (
        <Composer
          state={state}
          mode={compose.mode}
          request={compose.request}
          busy={busy}
          run={run}
          onClose={() => setCompose(null)}
        />
      )}
    </div>
  );
}
function SignInPage({
  state,
  busy,
  onGoogle,
}: {
  state: AppState;
  busy: boolean;
  onGoogle: () => void;
}) {
  const load = workload(state.tasks),
    p = person(state, "alex");
  const steps = state.subtasks.filter((s) => !s.completed).slice(0, 3);
  return (
    <div className="signin">
      <header className="signin-top">
        <Link className="brand" to="/employee/dashboard">
          <span className="brand-mark">
            h<span>·</span>
          </span>
          headroom<span className="brand-period">.</span>
        </Link>
      </header>
      <main className="signin-main">
        <section className="signin-copy">
          <h1>A little room to do your best work.</h1>
          <p className="signin-sub">
            Understand your workload and agree on a realistic week, together.
          </p>
          <div className="signin-card">
            <button className="btn provider" disabled={busy} onClick={onGoogle}>
              <span className="g-chip">
                {busy ? (
                  <LoaderCircle className="spin" size={14} color="#1f1e1c" />
                ) : (
                  <GoogleMark />
                )}
              </span>
              Continue with Google
            </button>
            <div className="signin-or" aria-hidden="true">
              <span>or</span>
            </div>
            <Link className="btn secondary full" to="/employee/dashboard">
              Explore the sample workspace
              <ArrowRight size={16} />
            </Link>
            <p className="fine-print">
              By continuing, you get a private demo workspace with synthetic
              data. Google is used for sign-in only — no access to your email or
              calendar.
            </p>
          </div>
          <p className="signin-foot">
            Capacity is a planning tool, not a measure of your value.
          </p>
        </section>
        <aside className="signin-visual" aria-hidden="true">
          <div className="preview-card">
            <span className="capacity-label">This week</span>
            <div className="capacity-number">
              {hours(load)}
              <span> / {p.capacity}h</span>
            </div>
            <Progress load={load} capacity={p.capacity} dark />
            <p className="capacity-note">
              <strong>{hours(p.capacity - load)}h of breathing room.</strong>{" "}
              Meetings, breaks, and life need space too.
            </p>
          </div>
          <div className="preview-list">
            {steps.map((s, i) => (
              <div className="preview-row" key={s.id}>
                <span className={`check-circle ${i === 0 ? "first" : ""}`} />
                <span>{s.title}</span>
                <small>
                  {s.minutes >= 60
                    ? `${hours(s.minutes / 60)}h`
                    : `${s.minutes} min`}
                </small>
              </div>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
}
function GoogleMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 9 0 9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
function PageHeading({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}
function CapacityCard({
  state,
  employee = "alex",
}: {
  state: AppState;
  employee?: string;
}) {
  const p = person(state, employee),
    load = workload(state.tasks, employee),
    over = load > p.capacity,
    onCapacityPage = useLocation().pathname.endsWith("/capacity");
  return (
    <section className="capacity-hero" aria-label="This week’s workload">
      <div className="capacity-figure">
        <span className="capacity-label">This week</span>
        <div className="capacity-number">
          {hours(load)}
          <span> / {p.capacity}h</span>
        </div>
      </div>
      <div className="capacity-detail">
        <div className="capacity-detail-head">
          <Badge load={load} capacity={p.capacity} />
          <span>Personalized workload</span>
        </div>
        <Progress load={load} capacity={p.capacity} dark />
        <p className="capacity-note">
          <strong>
            {over
              ? `${hours(load - p.capacity)}h over your recommended capacity.`
              : `${hours(p.capacity - load)}h of breathing room.`}
          </strong>{" "}
          {over
            ? "A small adjustment can make the week work."
            : "Meetings, breaks, and life need space too."}
        </p>
      </div>
      {!onCapacityPage && (
        <Link
          className="capacity-link"
          to="/employee/capacity"
          aria-label="View capacity breakdown"
        >
          <ArrowRight size={18} />
        </Link>
      )}
    </section>
  );
}
function Dashboard({
  state,
  busy,
  run,
  resolve,
}: {
  state: AppState;
  busy: boolean;
  run: Run;
  resolve: () => void;
}) {
  const load = workload(state.tasks),
    open = state.negotiations.find((n) =>
      ["pending", "counter_proposed"].includes(n.status),
    );
  const tasks = state.tasks
    .filter((t) => t.employee_id === "alex" && active(t))
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  const focus = state.subtasks
    .filter(
      (s) =>
        !s.completed &&
        state.tasks.some(
          (t) => t.id === s.task_id && active(t) && t.employee_id === "alex",
        ),
    )
    .slice(0, 3);
  const resolved =
    state.negotiations.some((n) => n.status === "approved") && load <= 30;
  return (
    <>
      <TaskInbox state={state} busy={busy} run={run} />
      <PageHeading
        eyebrow="Wednesday, September 23 · Week of Sep 21 – 27"
        title="Good morning, Alex."
        subtitle="One thing at a time. Let’s make today feel manageable."
      />
      {resolved && (
        <div className="banner success">
          <div>
            <strong>Conflict resolved. You have room to focus.</strong>
            <span>The agreed adjustment is reflected in your workload.</span>
          </div>
          <Link to="/employee/negotiations">
            View agreement <ArrowRight size={16} />
          </Link>
        </div>
      )}
      {load > 30 && (
        <div className="banner conflict">
          <div>
            <strong>Your week needs a little more room.</strong>
            <span>
              You’re {hours(load - 30)}h above capacity. Let’s find an
              adjustment together.
            </span>
          </div>
          {open ? (
            <Link
              className="btn danger"
              to={`/employee/negotiations/${open.id}`}
            >
              View request <ArrowRight size={16} />
            </Link>
          ) : (
            <button className="btn danger" onClick={resolve}>
              Resolve workload <ArrowRight size={16} />
            </button>
          )}
        </div>
      )}
      <CapacityCard state={state} />
      <section className="section">
        <div className="section-head">
          <h2>Today’s focus</h2>
          <span className="muted">{focus.length} small steps</span>
        </div>
        <div className="focus-list">
          {focus.length ? (
            focus.map((s, i) => (
              <div className="focus-item" key={s.id}>
                <button
                  aria-label={`Complete ${s.title}`}
                  className={`check-circle ${i === 0 ? "first" : ""}`}
                  disabled={busy}
                  onClick={() => run("subtask", { id: s.id })}
                >
                  <Check size={16} />
                </button>
                <Link to={`/employee/tasks/${s.task_id}`}>
                  <strong>{s.title}</strong>
                  <span>
                    Main task:{" "}
                    {state.tasks.find((t) => t.id === s.task_id)?.title}
                  </span>
                </Link>
                <span className="time-pill">
                  {s.minutes >= 60
                    ? `${hours(s.minutes / 60)}h`
                    : `${s.minutes} min`}
                </span>
              </div>
            ))
          ) : (
            <div className="empty">
              <p>All your focus steps are complete.</p>
              <Link to="/employee/tasks">See your tasks</Link>
            </div>
          )}
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Coming up this week</h2>
          <Link className="text-link" to="/employee/tasks">
            View all
          </Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Due</th>
                <th>Your estimate</th>
              </tr>
            </thead>
            <tbody>
              {tasks.slice(0, 4).map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link to={`/employee/tasks/${t.id}`}>
                      <span>
                        {t.title}
                        {risk(t, state) && (
                          <small className="risk-text">{risk(t, state)}</small>
                        )}
                      </span>
                    </Link>
                  </td>
                  <td>{due(t.deadline, true)}</td>
                  <td>{hours(t.personalized_hours)}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
/* Demo feed: messages assigned in Microsoft Teams that Headroom detected as
   potential tasks. Keyed by the draft task they would create. */
const TEAMS_MESSAGES: Record<
  string,
  { from: string; channel: string; time: string; text: string }
> = {
  "new-research": {
    from: "Sarah Lee",
    channel: "Design team",
    time: "9:12 AM",
    text: "Hi Alex, could you put together a competitor research summary for the client pitch? Focus on the three main competitors’ pricing pages and onboarding flows, and pull a few screenshots we can drop into the deck. Thursday morning would be ideal so we have time to review before the call. Thanks!",
  },
};
const DISMISSED_KEY = "headroom.dismissed";
function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function preview(text: string, words = 10) {
  const parts = text.split(/\s+/);
  return parts.length <= words ? text : parts.slice(0, words).join(" ") + "…";
}
function TaskInbox({
  state,
  busy,
  run,
}: {
  state: AppState;
  busy: boolean;
  run: Run;
}) {
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const [openId, setOpenId] = useState<string | null>(null);
  const drafts = state.tasks.filter(
    (t) =>
      t.employee_id === "alex" &&
      t.status === "draft" &&
      !dismissed.includes(t.id),
  );
  if (!drafts.length) return null;
  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  };
  return (
    <div className="inbox" aria-label="Potential new tasks">
      {drafts.map((t) => {
        const m = TEAMS_MESSAGES[t.id] ?? {
          from: "Sarah Lee",
          channel: "Design team",
          time: "",
          text: t.description,
        };
        const expanded = openId === t.id;
        return (
          <section className="inbox-item" key={t.id}>
            <div className="inbox-main">
              <span className="inbox-source">
                Microsoft Teams · {m.from} in {m.channel}
                {m.time && ` · ${m.time}`}
              </span>
              <strong>Potential New Task</strong>
              <button
                className="inbox-toggle"
                aria-expanded={expanded}
                aria-controls={`inbox-${t.id}`}
                onClick={() => setOpenId(expanded ? null : t.id)}
              >
                <span>{expanded ? m.text : preview(m.text)}</span>
                <ChevronDown size={16} />
              </button>
              {expanded && (
                <p className="inbox-detail" id={`inbox-${t.id}`}>
                  Would add <b>{t.title}</b> · {hours(t.personalized_hours)}h
                  personalized estimate · due {due(t.deadline, true)}
                </p>
              )}
            </div>
            <div className="inbox-side">
              <TeamsMark />
              <div className="inbox-actions">
                <button
                  className="inbox-yes"
                  aria-label={`Confirm ${t.title} is a task`}
                  title="This is a task"
                  disabled={busy}
                  onClick={() => run("activate", { id: t.id })}
                >
                  <Check size={18} />
                </button>
                <button
                  className="inbox-no"
                  aria-label={`Remove ${t.title}, not a task`}
                  title="Not a task"
                  disabled={busy}
                  onClick={() => dismiss(t.id)}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
/** Simplified Microsoft Teams mark: purple tile with a T and two heads. */
function TeamsMark() {
  return (
    <svg
      className="inbox-logo"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      role="img"
      aria-label="Microsoft Teams"
    >
      <circle cx="18.5" cy="6.5" r="2.5" fill="#7B83EB" />
      <path
        d="M15.5 10h5.3c.7 0 1.2.5 1.2 1.2v4.6a4 4 0 0 1-4 4h-.3a4.4 4.4 0 0 1-2.2-.6V10Z"
        fill="#7B83EB"
      />
      <circle cx="12.5" cy="5.5" r="3" fill="#5059C9" />
      <path
        d="M8 9.5h9.2c.7 0 1.3.6 1.3 1.3v5.7a5.5 5.5 0 0 1-5.5 5.5h-.1A5.4 5.4 0 0 1 8 17.4V9.5Z"
        fill="#5059C9"
      />
      <rect x="1" y="6" width="12" height="12" rx="2.2" fill="#4B53BC" />
      <path d="M4.2 9.6h5.6v1.6H7.9v5.2H6.1v-5.2H4.2V9.6Z" fill="#fff" />
    </svg>
  );
}
function TaskRow({
  task,
  state,
  busy,
  onBreakdown,
}: {
  task: Task;
  state: AppState;
  busy: boolean;
  onBreakdown: Breakdown;
}) {
  const subs = state.subtasks.filter((s) => s.task_id === task.id),
    done = subs.filter((s) => s.completed).length,
    needsSteps = !subs.length && active(task);
  return (
    <div className="task-row">
      <div className="task-main">
        <Link className="task-link" to={`/employee/tasks/${task.id}`}>
          <strong>{task.title}</strong>
        </Link>
        <span>
          {task.category} <span className="bullet">·</span> Due{" "}
          {due(task.deadline, true)}
        </span>
        {risk(task, state) && (
          <small className="risk-text">{risk(task, state)}</small>
        )}
      </div>
      <span className={`priority ${task.priority.toLowerCase()}`}>
        {task.priority}
      </span>
      <div className="task-estimate">
        <strong>
          {hours(task.personalized_hours)}h <span>personalized</span>
        </strong>
        <small>{hours(task.estimated_hours)}h original estimate</small>
      </div>
      <div className="task-progress">
        {needsSteps ? (
          <button
            className="btn secondary breakdown-btn"
            disabled={busy}
            onClick={() => onBreakdown(task)}
          >
            AI breakdown
          </button>
        ) : (
          <>
            <span>
              {task.status === "completed"
                ? "Completed"
                : `${done} / ${subs.length} steps`}
            </span>
            <div className="mini-progress">
              <span
                style={{
                  width: `${task.status === "completed" ? 100 : subs.length ? (done / subs.length) * 100 : 0}%`,
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
const TASK_FILTERS = [
  "All",
  "Today",
  "This Week",
  "At Risk",
  "Completed",
] as const;
function TasksPage({
  state,
  busy,
  onBreakdown,
}: {
  state: AppState;
  busy: boolean;
  onBreakdown: Breakdown;
}) {
  const [filter, setFilter] = useState<(typeof TASK_FILTERS)[number]>("All");
  const tasks = state.tasks
    .filter(
      (t) =>
        t.employee_id === "alex" &&
        t.status !== "draft" &&
        t.status !== "cancelled",
    )
    .filter((t) =>
      filter === "Completed"
        ? t.status === "completed"
        : filter === "At Risk"
          ? !!risk(t, state)
          : filter === "Today"
            ? active(t) && t.deadline.startsWith(state.workspace.demo_date)
            : filter === "This Week"
              ? active(t) && Date.parse(t.deadline) < Date.parse(WEEK_END)
              : true,
    );
  return (
    <>
      <PageHeading
        title="My tasks"
        subtitle="Confirmed work with estimates personalized to your pace."
      />
      <Segmented
        label="Filter tasks"
        options={TASK_FILTERS}
        value={filter}
        onChange={setFilter}
      />
      <div className="task-list">
        {tasks.length ? (
          tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              state={state}
              busy={busy}
              onBreakdown={onBreakdown}
            />
          ))
        ) : (
          <div className="empty">
            <h3>Nothing here right now.</h3>
            <p>Try another filter to see the rest of your work.</p>
          </div>
        )}
      </div>
    </>
  );
}
function TaskDetail({
  state,
  busy,
  run,
  onBreakdown,
}: {
  state: AppState;
  busy: boolean;
  run: Run;
  onBreakdown: Breakdown;
}) {
  const { id } = useParams(),
    task = state.tasks.find(
      (t) => t.id === id && t.employee_id === "alex" && t.status !== "draft",
    );
  const [actual, setActual] = useState(""),
    [completeOpen, setCompleteOpen] = useState(false);
  useEffect(() => {
    setActual(String(task?.actual_hours ?? 0));
  }, [task?.id, task?.actual_hours]);
  if (!task) return <NotFound />;
  const subs = state.subtasks.filter((s) => s.task_id === id),
    deps = state.dependencies.filter((d) => d.task_id === id),
    disabled = !active(task);
  return (
    <>
      <Link className="back-link" to="/employee/tasks">
        <ArrowLeft size={16} />
        Back to my tasks
      </Link>
      <PageHeading
        eyebrow={task.category}
        title={task.title}
        subtitle={task.description}
      />
      <dl className="meta-strip">
        <div>
          <dt>Priority</dt>
          <dd>
            <span className={`priority ${task.priority.toLowerCase()}`}>
              {task.priority}
            </span>
          </dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd>{due(task.deadline)}</dd>
        </div>
        <div>
          <dt>Assigned by</dt>
          <dd>Sarah Lee</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd className="capitalize">{task.status.replace("_", " ")}</dd>
        </div>
        <div>
          <dt>Your estimate</dt>
          <dd>
            {hours(task.personalized_hours)}h
            <small>
              {" "}
              · {hours(task.estimated_hours)}h × {task.multiplier.toFixed(2)}
            </small>
          </dd>
        </div>
      </dl>
      <section className="section">
        <div className="section-head">
          <h2>Your next steps</h2>
          {subs.length ? (
            <span className="muted">
              {subs.filter((s) => s.completed).length} / {subs.length} complete
            </span>
          ) : (
            !disabled && (
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() => onBreakdown(task)}
              >
                AI breakdown
              </button>
            )
          )}
        </div>
        <div className="subtask-list">
          {subs.length ? (
            subs.map((s) => (
              <label key={s.id} className={s.completed ? "done" : ""}>
                <input
                  type="checkbox"
                  checked={s.completed}
                  disabled={busy || disabled}
                  onChange={() => run("subtask", { id: s.id })}
                />
                <span>{s.title}</span>
                <small>{s.minutes} min</small>
              </label>
            ))
          ) : (
            <p className="muted">
              No steps yet. Use AI breakdown to split this task into smaller
              steps, or record your time below when you’re ready.
            </p>
          )}
        </div>
      </section>
      <section className="section">
        <h2>Dependencies</h2>
        {deps.length ? (
          deps.map((d) => (
            <p key={d.prerequisite_id}>
              {state.tasks.find((t) => t.id === d.prerequisite_id)?.title}
            </p>
          ))
        ) : (
          <p className="muted">No prerequisites. You can get started.</p>
        )}
      </section>
      <section className="section">
        <h2>Time spent</h2>
        <p className="muted">
          Actual time helps personalize estimates for future tasks. Your
          estimate stays fixed while the task is active.
        </p>
        <div className="hours-form">
          <label>
            <span>Total hours</span>
            <input
              type="number"
              min="0"
              max="500"
              step="0.1"
              value={actual}
              disabled={disabled}
              onChange={(e) => setActual(e.target.value)}
            />
          </label>
          <button
            className="btn secondary"
            disabled={busy || disabled || actual === ""}
            onClick={() => run("hours", { id, actual_hours: Number(actual) })}
          >
            Save time
          </button>
          <button
            className="btn primary"
            disabled={
              busy ||
              disabled ||
              Number(actual) <= 0 ||
              !Number.isFinite(Number(actual))
            }
            onClick={() => setCompleteOpen(true)}
          >
            <Check size={16} />
            {task.status === "completed" ? "Completed" : "Complete task"}
          </button>
        </div>
      </section>
      {completeOpen && (
        <Modal
          title="Mark this task complete?"
          onClose={() => setCompleteOpen(false)}
        >
          <p className="muted">
            Save {actual} actual hours and mark all remaining steps complete.
            This will update the estimates used for future tasks.
          </p>
          <div className="modal-actions">
            <button
              className="btn secondary"
              onClick={() => setCompleteOpen(false)}
            >
              Keep working
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                if (await run("complete", { id, actual_hours: Number(actual) }))
                  setCompleteOpen(false);
              }}
            >
              Complete task
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function Breakdown({
  state,
  employee = "alex",
  next = false,
}: {
  state: AppState;
  employee?: string;
  next?: boolean;
}) {
  const tasks = state.tasks.filter(
    (t) =>
      t.employee_id === employee &&
      active(t) &&
      Date.parse(t.deadline) <
        Date.parse(next ? "2026-10-05T00:00:00+07:00" : WEEK_END) &&
      (!next || Date.parse(t.deadline) >= Date.parse(WEEK_END)),
  );
  const total = workload(state.tasks, employee, next);
  return (
    <div className="breakdown">
      {tasks.length ? (
        tasks.map((t, i) => (
          <div className="breakdown-row" key={t.id}>
            <span className={`color-key key-${i % 5}`} />
            <div>
              <strong>{t.title}</strong>
              <div className="breakdown-track">
                <span
                  className={`key-${i % 5}`}
                  style={{
                    width: `${Math.max(2, (t.personalized_hours / Math.max(total, 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
            <b>{hours(t.personalized_hours)}h</b>
          </div>
        ))
      ) : (
        <p className="muted">No active tasks due in this week.</p>
      )}
      <div className="breakdown-total">
        <span>Total active workload</span>
        <strong>{hours(total)}h</strong>
      </div>
    </div>
  );
}
function CapacityPage({
  state,
  resolve,
}: {
  state: AppState;
  resolve: () => void;
}) {
  const [next, setNext] = useState(false);
  const canResolve =
    workload(state.tasks) > 30 &&
    !state.negotiations.some((n) =>
      ["pending", "counter_proposed"].includes(n.status),
    );
  const categories = [
    "Research",
    "Presentation",
    "Testing",
    "Analytics",
    "Design",
  ];
  return (
    <>
      <PageHeading
        title="My capacity"
        subtitle="A planning tool, not a measure of your value."
      />
      <CapacityCard state={state} />
      <section className="section">
        <div className="section-head">
          <h2>Where your capacity goes</h2>
          <Segmented
            label="Week"
            options={["This week", "Next week"] as const}
            value={next ? "Next week" : "This week"}
            onChange={(v) => setNext(v === "Next week")}
          />
        </div>
        <Breakdown state={state} next={next} />
        <p className="caption">
          Active work due {next ? "next" : "this"} week, plus overdue carryover
          for this week. Full estimates stay counted until tasks are completed;
          logged time does not subtract from this planning total.
        </p>
      </section>
      <section className="section">
        <h2>Why 30 hours?</h2>
        <p className="muted">
          In a 40-hour week, we leave 10 hours for meetings, admin,
          communication, and breaks. This is a configured starting point for the
          demo, not a clinical assessment.
        </p>
        <div className="week-split">
          <span>30h focus</span>
          <span>10h other</span>
        </div>
        {canResolve && (
          <button className="btn primary" onClick={resolve}>
            Resolve workload <ArrowRight size={16} />
          </button>
        )}
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Learning your rhythm</h2>
          <span className="muted">From your completed work</span>
        </div>
        <div className="table-wrap">
          <table className="learning-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Original average</th>
                <th>Your recent average</th>
                <th>Basis</th>
                <th>Adjustment</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => {
                const m = multiplier(state.history, "alex", category);
                const sample = state.history
                    .filter(
                      (h) =>
                        h.employee_id === "alex" && h.category === category,
                    )
                    .slice(0, 10),
                  avg = (key: "estimated_hours" | "actual_hours") =>
                    sample.reduce((n, h) => n + h[key], 0) /
                    (sample.length || 1);
                return (
                  <tr key={category}>
                    <td>{category}</td>
                    <td>{hours(avg("estimated_hours"))}h</td>
                    <td>{hours(avg("actual_hours"))}h</td>
                    <td>
                      {m.count} samples ·{" "}
                      {m.categorySpecific ? "category" : "overall"} pattern
                    </td>
                    <td>{m.value.toFixed(2)}×</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="caption">
          We average actual-to-estimated time ratios from up to 10 recent tasks.
          Categories need 3 samples; otherwise your overall pattern is used. New
          learning applies to future estimates.
        </p>
      </section>
    </>
  );
}
function ManagerDashboard({ state }: { state: AppState }) {
  const employees = state.profiles
    .filter((p) => p.id !== "sarah")
    .sort(
      (a, b) =>
        workload(state.tasks, b.id) / b.capacity -
        workload(state.tasks, a.id) / a.capacity,
    );
  const states = employees.map(
    (p) => status(workload(state.tasks, p.id), p.capacity).label,
  );
  const openRequests = state.negotiations.filter((n) =>
    ["pending", "counter_proposed"].includes(n.status),
  ).length;
  return (
    <>
      <PageHeading
        eyebrow="Wednesday, September 23 · Week of Sep 21 – 27"
        title="Good morning, Sarah."
        subtitle="See where the team has room, and where a conversation could help."
      />
      <dl className="stats-row">
        <div>
          <dd>{employees.length}</dd>
          <dt>Team members</dt>
        </div>
        <div>
          <dd>{states.filter((s) => s === "Capacity Conflict").length}</dd>
          <dt>Capacity conflicts</dt>
        </div>
        <div>
          <dd>{states.filter((s) => s === "Near Capacity").length}</dd>
          <dt>Near capacity</dt>
        </div>
        <div>
          <dd>{openRequests}</dd>
          <dt>Open requests</dt>
        </div>
      </dl>
      <section className="section">
        <div className="section-head">
          <h2>Everyone’s week</h2>
          <span className="muted">Sorted by capacity pressure</span>
        </div>
        <div className="team-list">
          {employees.map((p) => {
            const load = workload(state.tasks, p.id),
              risks = state.tasks.filter(
                (t) => t.employee_id === p.id && risk(t, state),
              ).length,
              requests = state.negotiations.filter(
                (n) =>
                  n.employee_id === p.id &&
                  ["pending", "counter_proposed"].includes(n.status),
              ).length;
            return (
              <Link
                className="team-row"
                to={`/manager/employees/${p.id}`}
                key={p.id}
              >
                <Avatar name={p.name} />
                <div className="team-who">
                  <strong>{p.name}</strong>
                  <span>
                    {p.job_title}
                    <span className="bullet">·</span>
                    {risks ? `${risks} tasks at risk` : "No tasks at risk"}
                    {requests > 0 && (
                      <>
                        <span className="bullet">·</span>
                        {requests} request pending
                      </>
                    )}
                  </span>
                </div>
                <div className="team-meter">
                  <Progress load={load} capacity={p.capacity} />
                </div>
                <strong className="team-hours">
                  {hours(load)}
                  <span> / {p.capacity}h</span>
                </strong>
                <Badge load={load} capacity={p.capacity} />
              </Link>
            );
          })}
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Workload requests</h2>
          <Link className="text-link" to="/manager/negotiations">
            View all
          </Link>
        </div>
        {state.negotiations.length ? (
          state.negotiations
            .slice(0, 3)
            .map((n) => (
              <RequestRow key={n.id} n={n} role="manager" state={state} />
            ))
        ) : (
          <p className="muted">
            No requests yet. New conversations will appear here.
          </p>
        )}
      </section>
      <p className="privacy-note">
        You see confirmed work, capacity, and shared requests. Personal notes
        and health information are never part of this view.
      </p>
    </>
  );
}
function EmployeeDetail({ state }: { state: AppState }) {
  const { id } = useParams(),
    p = state.profiles.find((p) => p.id === id && p.id !== "sarah");
  if (!p) return <NotFound />;
  const load = workload(state.tasks, p.id);
  const requests = state.negotiations.filter((n) => n.employee_id === p.id);
  return (
    <>
      <Link className="back-link" to="/manager/dashboard">
        <ArrowLeft size={16} />
        Back to team overview
      </Link>
      <PageHeading title={p.name} subtitle={p.job_title}>
        <Badge load={load} capacity={p.capacity} />
      </PageHeading>
      <dl className="stats-row">
        <div>
          <dd>{hours(load)}h</dd>
          <dt>Current workload</dt>
        </div>
        <div>
          <dd>{p.capacity}h</dd>
          <dt>Weekly focus capacity</dt>
        </div>
        <div>
          <dd>{hours(Math.abs(load - p.capacity))}h</dd>
          <dt>{load > p.capacity ? "Above capacity" : "Available"}</dt>
        </div>
      </dl>
      <section className="section">
        <div className="section-head">
          <h2>Confirmed work this week</h2>
          <span className="muted">Personalized estimates</span>
        </div>
        <Breakdown state={state} employee={p.id} />
      </section>
      <section className="section">
        <h2>Shared workload requests</h2>
        {requests.length ? (
          requests.map((n) => (
            <RequestRow key={n.id} n={n} role="manager" state={state} />
          ))
        ) : (
          <p className="muted">No requests for this teammate.</p>
        )}
      </section>
    </>
  );
}
function RequestRow({
  n,
  role,
  state,
}: {
  n: Negotiation;
  role: Role;
  state: AppState;
}) {
  return (
    <Link className="request-row" to={`/${role}/negotiations/${n.id}`}>
      <div>
        <ProposalTitle state={state} proposal={n.proposal} />
        <span>Alex Morgan · Sarah Lee · Revision {n.revision}</span>
      </div>
      <span
        className={`badge ${n.status === "approved" ? "good" : n.status === "declined" ? "neutral" : "warning"}`}
      >
        {n.status.replace("_", " ")}
      </span>
    </Link>
  );
}
const REQUEST_FILTERS = ["All", "Open", "Closed"] as const;
function Requests({
  state,
  role,
  resolve,
}: {
  state: AppState;
  role: Role;
  resolve: () => void;
}) {
  const [filter, setFilter] = useState<(typeof REQUEST_FILTERS)[number]>("All");
  const list = state.negotiations.filter(
    (n) =>
      filter === "All" ||
      (filter === "Open"
        ? ["pending", "counter_proposed"].includes(n.status)
        : !["pending", "counter_proposed"].includes(n.status)),
  );
  return (
    <>
      <PageHeading
        title="Workload requests"
        subtitle="Discuss priorities and agree on a realistic plan together."
      >
        {role === "employee" &&
          workload(state.tasks) > 30 &&
          !state.negotiations.some((n) =>
            ["pending", "counter_proposed"].includes(n.status),
          ) && (
            <button className="btn primary" onClick={resolve}>
              <Plus size={17} />
              New request
            </button>
          )}
      </PageHeading>
      <Segmented
        label="Filter requests"
        options={REQUEST_FILTERS}
        value={filter}
        onChange={setFilter}
      />
      <div className="request-list">
        {list.length ? (
          list.map((n) => (
            <RequestRow key={n.id} n={n} role={role} state={state} />
          ))
        ) : (
          <div className="empty">
            <h3>A little conversation can make room.</h3>
            <p>
              No {filter === "All" ? "" : filter.toLowerCase() + " "}requests
              yet. If your workload exceeds capacity, start from Resolve
              Workload.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
function ProposalImpact({
  state,
  proposal,
}: {
  state: AppState;
  proposal: Proposal;
}) {
  const task = state.tasks.find((t) => t.id === proposal.task_id);
  if (!task) return null;
  const after = applyPreview(state, proposal),
    before = workload(state.tasks),
    load = workload(after),
    other =
      proposal.type === "reassign" ? person(state, proposal.employee_id) : null;
  return (
    <div className="proposal-impact">
      <div className="impact-numbers">
        <div>
          <span>This week now</span>
          <strong>
            {hours(before)}
            <small> / 30h</small>
          </strong>
        </div>
        <ArrowRight size={24} />
        <div>
          <span>With this adjustment</span>
          <strong>
            {hours(load)}
            <small> / 30h</small>
          </strong>
        </div>
      </div>
      <Progress load={load} capacity={30} />
      <div className="impact-result">
        <span>{hours(before - load)}h moved out of this week</span>
        <Badge load={load} capacity={30} />
      </div>
      {proposal.type === "deadline" && (
        <p>
          {due(task.deadline, true)} → {due(proposal.deadline!, true)}. Next
          week: {hours(workload(after, "alex", true))} / 30h.
        </p>
      )}
      {proposal.type === "scope" && (
        <p>
          Omit the detailed competitor analysis section.{" "}
          {load > 30
            ? `${hours(load - 30)}h would still be above capacity.`
            : "The remaining workload fits."}
        </p>
      )}
      {other && (
        <p>
          {other.name}: {hours(workload(after, other.id))} / {other.capacity}h
          after reassignment.
        </p>
      )}
    </div>
  );
}
function Composer({
  state,
  mode,
  request,
  busy,
  run,
  onClose,
}: {
  state: AppState;
  mode: "request" | "counter" | "revise";
  request?: Negotiation;
  busy: boolean;
  run: Run;
  onClose: () => void;
}) {
  const options = recommendations(state);
  const [selected, setSelected] = useState(0),
    [message, setMessage] = useState("");
  const proposal = options[selected];
  useEffect(() => {
    if (proposal)
      setMessage(
        mode === "counter"
          ? `Thanks for raising this. Could we ${proposal.label.charAt(0).toLowerCase() + proposal.label.slice(1)} instead? Let's keep the work realistic.`
          : `Based on my current workload, I'd like to ${proposal.label.charAt(0).toLowerCase() + proposal.label.slice(1)}. This would bring my active workload to ${hours(workload(applyPreview(state, proposal)))} / 30h. Would that adjustment work?`,
      );
  }, [selected, mode]);
  return (
    <Modal
      title={
        mode === "counter"
          ? "Suggest another way forward"
          : mode === "revise"
            ? "Suggest another adjustment"
            : "Make a little room this week"
      }
      onClose={onClose}
    >
      <p className="muted">
        Choose an adjustment to discuss. Tasks change only when you both agree.
      </p>
      <div
        className="proposal-options"
        role="radiogroup"
        aria-label="Workload adjustments"
      >
        {options.map((o, i) => (
          <button
            role="radio"
            aria-checked={selected === i}
            className={selected === i ? "selected" : ""}
            key={o.label}
            onClick={() => setSelected(i)}
          >
            <span className="radio-mark">{selected === i && <span />}</span>
            <span>
              <ProposalTitle state={state} proposal={o} />
              <small>
                {hours(
                  workload(state.tasks) - workload(applyPreview(state, o)),
                )}
                h less this week
                {workload(applyPreview(state, o)) > 30
                  ? " · partial relief"
                  : " · fits capacity"}
              </small>
            </span>
            {i === 0 && <span className="recommended">Suggested</span>}
          </button>
        ))}
      </div>
      {proposal ? (
        <>
          <ProposalImpact state={state} proposal={proposal} />
          <label className="message-label">
            Your message
            <textarea
              maxLength={4000}
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button className="btn secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn primary"
              disabled={busy || !message.trim()}
              onClick={async () => {
                if (await run(mode, { id: request?.id, proposal, message }))
                  onClose();
              }}
            >
              {busy && <LoaderCircle className="spin" size={16} />}
              {mode === "counter" ? "Send counter-proposal" : "Send to Sarah"}
            </button>
          </div>
        </>
      ) : (
        <p className="muted">
          No automatic adjustments are available for the remaining tasks.
        </p>
      )}
    </Modal>
  );
}
function RequestDetail({
  state,
  role,
  busy,
  run,
  compose,
}: {
  state: AppState;
  role: Role;
  busy: boolean;
  run: Run;
  compose: (mode: "counter" | "revise", n: Negotiation) => void;
}) {
  const { id } = useParams(),
    n = state.negotiations.find((n) => n.id === id);
  if (!n) return <NotFound />;
  const open = ["pending", "counter_proposed"].includes(n.status);
  const task = state.tasks.find((t) => t.id === n.proposal.task_id);
  const stale = task?.version !== n.proposal.task_version;
  return (
    <>
      <Link className="back-link" to={`/${role}/negotiations`}>
        <ArrowLeft size={16} />
        Back to requests
      </Link>
      <PageHeading
        eyebrow="Alex Morgan ↔ Sarah Lee"
        title={proposalTitle(state, n.proposal)}
        subtitle={`Revision ${n.revision} · ${n.status.replace("_", " ")}`}
      />
      <section className="section">
        <h2>The proposed adjustment</h2>
        {open ? (
          <ProposalImpact state={state} proposal={n.proposal} />
        ) : (
          <div className="resolved-summary">
            <p>
              {n.status === "approved"
                ? "This adjustment was approved and applied."
                : `This request was ${n.status}. No task changes were applied.`}
            </p>
            <strong>
              Current workload: {hours(workload(state.tasks))} / 30h
            </strong>
          </div>
        )}
        {open && stale && (
          <div className="warning-box">
            This task changed after the proposal was sent.{" "}
            {role === "manager"
              ? "Send a fresh counter-proposal."
              : "Cancel this request and propose a fresh adjustment, or revise the counter-proposal."}
          </div>
        )}
        <div className="request-actions">
          {role === "manager" && n.status === "pending" && (
            <>
              <button
                className="btn primary"
                disabled={busy || stale}
                onClick={() => run("approve", { id })}
              >
                <Check size={17} />
                Approve adjustment
              </button>
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() => compose("counter", n)}
              >
                Counter-propose
              </button>
              <button
                className="btn text-danger"
                disabled={busy}
                onClick={() => run("decline", { id })}
              >
                Decline
              </button>
            </>
          )}
          {role === "employee" && n.status === "counter_proposed" && (
            <>
              <button
                className="btn primary"
                disabled={busy || stale}
                onClick={() => run("accept", { id })}
              >
                Accept counter-proposal
              </button>
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() => compose("revise", n)}
              >
                Suggest another change
              </button>
            </>
          )}
          {role === "employee" && open && (
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => run("cancel", { id })}
            >
              Cancel request
            </button>
          )}
          {role === "employee" && n.status === "pending" && (
            <p className="muted">
              Waiting for Sarah’s response. Your assignments stay unchanged
              until approval.
            </p>
          )}
        </div>
      </section>
      <section className="section">
        <h2>The conversation</h2>
        <div className="timeline">
          {state.messages
            .filter((m) => m.negotiation_id === id)
            .map((m) => (
              <div className="timeline-item" key={m.id}>
                <Avatar
                  name={m.author === "employee" ? "Alex Morgan" : "Sarah Lee"}
                />
                <div>
                  <strong>
                    {m.author === "employee" ? "Alex" : "Sarah"}
                    <small>Revision {m.revision}</small>
                  </strong>
                  <p>{m.body}</p>
                </div>
              </div>
            ))}
        </div>
      </section>
    </>
  );
}
function NotFound() {
  return (
    <div className="empty">
      <h1>We couldn’t find that item.</h1>
      <Link className="btn primary" to="/employee/dashboard">
        Back to overview
      </Link>
    </div>
  );
}
