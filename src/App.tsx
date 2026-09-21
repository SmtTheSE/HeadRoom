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
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  Focus,
  Gauge,
  LayoutDashboard,
  ListTodo,
  LoaderCircle,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  AlertCircle,
  CheckCircle2,
  Leaf,
} from "lucide-react";
import { action, loadState, supabase } from "./data";
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
function Badge({ load, capacity }: { load: number; capacity: number }) {
  const s = status(load, capacity);
  return (
    <span className={`badge ${s.tone}`}>
      <span className="status-dot" />
      {s.label}
    </span>
  );
}
function Avatar({ name, large = false }: { name: string; large?: boolean }) {
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
    <dialog className="modal" ref={ref} onCancel={onClose} aria-label={title}>
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
    [notice, setNotice] = useState(""),
    [authOpen, setAuthOpen] = useState(false),
    [resetOpen, setResetOpen] = useState(false);
  const [compose, setCompose] = useState<{
    mode: "request" | "counter" | "revise";
    request?: Negotiation;
  } | null>(null);
  const location = useLocation(),
    navigate = useNavigate(),
    cache = useQueryClient();
  const role: Role = location.pathname.startsWith("/manager")
    ? "manager"
    : "employee";
  useEffect(() => {
    let mounted = true;
    const authError = new URLSearchParams(window.location.search).get("error_description");
    if (authError) setNotice(authError);
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (mounted) {
          setSession(data.session);
          setReady(true);
          if (error) setNotice(error.message);
        }
      })
      .catch(() => {
        if (mounted) {
          setNotice("We could not restore your sign-in. Please try again.");
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
      setAuthOpen(true);
      return false;
    }
    if (!query.data) {
      setNotice("Your workspace is not ready yet. Please retry loading it.");
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
      setNotice(error.message);
      setBusy(false);
    }
  }
  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setNotice(error.message);
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
  const page = location.pathname.includes("capacity")
    ? "My capacity"
    : location.pathname.includes("tasks")
      ? "My tasks"
      : location.pathname.includes("negotiations")
        ? "Workload requests"
        : location.pathname.includes("employees")
          ? "Team member"
          : role === "manager"
            ? "Team overview"
            : "My overview";
  const p = person(state, role === "employee" ? "alex" : "sarah");
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to={`/${role}/dashboard`}>
          <span className="brand-mark">
            h<span>·</span>
          </span>
          headroom<span className="brand-period">.</span>
        </Link>
        <div className="workspace-label">DESIGN WORKSPACE</div>
        <nav>
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
          <div className="sidebar-note">
            <Leaf size={20} />
            <p>
              Good work starts
              <br />
              with a little headroom.
            </p>
          </div>
          <div className="profile-mini">
            <Avatar name={p.name} />
            <div>
              <strong>{p.name}</strong>
              <small>{p.job_title}</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={15} /> <strong>{page}</strong>
          </div>
          <div className="top-actions">
            <span className="demo-label">DEMO VIEW</span>
            <div className="role-toggle" aria-label="View as">
              <button
                className={role === "employee" ? "selected" : ""}
                onClick={() => changeRole("employee")}
              >
                Employee
              </button>
              <button
                className={role === "manager" ? "selected" : ""}
                onClick={() => changeRole("manager")}
              >
                Manager
              </button>
            </div>
            {session ? (
              <button
                className="icon-btn"
                onClick={signOut}
                aria-label="Sign out"
                title={`Signed in as ${session.user.email}`}
              >
                <LogOut size={18} />
              </button>
            ) : (
              <button className="signin-top" onClick={() => setAuthOpen(true)}>
                Sign in
              </button>
            )}
          </div>
        </header>
        <div className="demo-strip">
          <span>
            <span className="tiny-dot" />
            {session
              ? "Your private demo workspace"
              : "Sample workspace · sign in to save changes"}
            <span className="strip-divider">/</span>Week of September 21, 2026
          </span>
          <button
            disabled={busy}
            onClick={() => (session ? setResetOpen(true) : setAuthOpen(true))}
          >
            <RotateCcw size={13} />
            Reset demo
          </button>
        </div>
        <main>
          {ready && session && query.isError ? (
            <div className="connection-error">
              <AlertCircle size={30} />
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
                element={<TasksPage state={state} />}
              />
              <Route
                path="/employee/tasks/:id"
                element={<TaskDetail state={state} busy={busy} run={run} />}
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
        <footer className="footer">
          <span>
            <ShieldCheck size={14} />
            Shared work. Personal boundaries.
          </span>
          <span>Built for a more sustainable workday.</span>
        </footer>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          <span>{notice}</span>
          <button onClick={() => setNotice("")} aria-label="Dismiss message">
            <X size={16} />
          </button>
        </div>
      )}
      {authOpen && (
        <Modal
          title="A little room to do your best work."
          onClose={() => setAuthOpen(false)}
        >
          <div className="auth-art">
            <span className="brand-mark">
              h<span>·</span>
            </span>
            <div className="auth-line" />
            <Focus size={40} />
          </div>
          <p className="muted">
            Sign in to save your tasks, explore your capacity, and try the
            complete employee-to-manager workflow.
          </p>
          <div className="info-box">
            <ShieldCheck size={18} />
            <p>
              You’ll get your own demo workspace with Alex and Sarah. All
              employee information is synthetic.
            </p>
          </div>
          <button className="btn google full" disabled={busy} onClick={signIn}>
            <span className="google-g">G</span>Continue with Google
            <ArrowRight size={18} />
          </button>
          <p className="fine-print">
            Your Google account is used for sign-in only. No access to your
            email or calendar.
          </p>
        </Modal>
      )}
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
  compact = false,
}: {
  state: AppState;
  employee?: string;
  compact?: boolean;
}) {
  const p = person(state, employee),
    load = workload(state.tasks, employee);
  return (
    <section className={`capacity-card ${compact ? "compact" : ""}`}>
      <div className="card-top">
        <span>
          <Gauge size={18} />
          YOUR WEEK, AT A GLANCE
        </span>
        <Badge load={load} capacity={p.capacity} />
      </div>
      <div className="capacity-number">
        {hours(load)}
        <span> / {p.capacity}h</span>
      </div>
      <p className="capacity-description">Personalized workload · this week</p>
      <Progress load={load} capacity={p.capacity} dark />
      <div className="capacity-scale">
        <span>0h</span>
        <span>{p.capacity}h focus capacity</span>
      </div>
      <div className="capacity-bottom">
        <span className="capacity-symbol">
          {load > p.capacity ? <AlertCircle size={20} /> : <Leaf size={20} />}
        </span>
        <p>
          <strong>
            {load > p.capacity
              ? `${hours(load - p.capacity)}h over your recommended capacity`
              : `${hours(p.capacity - load)}h of breathing room`}
          </strong>
          <span>
            {load > p.capacity
              ? "A small adjustment can make the week work."
              : "Meetings, breaks, and life need space too."}
          </span>
        </p>
        <Link to="/employee/capacity" aria-label="View capacity breakdown">
          <ArrowUpRight size={22} />
        </Link>
      </div>
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
    draft =
      state.tasks.find((t) => t.id === "new-research")?.status === "draft",
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
      <PageHeading
        eyebrow="WEDNESDAY, SEPTEMBER 23"
        title="Good morning, Alex."
        subtitle="One thing at a time. Let’s make today feel manageable."
      >
        <span className="date-chip">
          <CalendarDays size={17} />
          Sep 21 – 27
        </span>
      </PageHeading>
      {resolved && (
        <div className="success-banner">
          <CheckCircle2 size={21} />
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
        <div className="conflict-banner">
          <AlertCircle size={22} />
          <div>
            <strong>Your week needs a little more room.</strong>
            <span>
              You’re {hours(load - 30)}h above capacity. Let’s find an
              adjustment together.
            </span>
          </div>
          {open ? (
            <Link
              className="btn danger-btn"
              to={`/employee/negotiations/${open.id}`}
            >
              View request <ArrowRight size={16} />
            </Link>
          ) : (
            <button className="btn danger-btn" onClick={resolve}>
              Resolve workload <ArrowRight size={16} />
            </button>
          )}
        </div>
      )}
      <div className="dashboard-grid">
        <section className="card focus-card">
          <div className="section-head">
            <h2>
              <Focus size={21} />
              Today’s focus
            </h2>
            <span className="muted small">{focus.length} small steps</span>
          </div>
          <p className="section-description">
            A clear place to start. Everything else can wait.
          </p>
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
                      {state.tasks.find((t) => t.id === s.task_id)?.title}
                    </span>
                  </Link>
                  <span className="time-pill">
                    <Clock3 size={13} />
                    {s.minutes >= 60
                      ? `${hours(s.minutes / 60)}h`
                      : `${s.minutes} min`}
                  </span>
                </div>
              ))
            ) : (
              <div className="empty">
                <CheckCheck />
                <p>All your focus steps are complete.</p>
                <Link to="/employee/tasks">See your tasks</Link>
              </div>
            )}
          </div>
          <Link className="text-link focus-footer" to="/employee/tasks">
            See all my tasks <ArrowRight size={16} />
          </Link>
        </section>
        <CapacityCard state={state} />
      </div>
      <div className="lower-grid">
        <section className="card deadlines-card">
          <div className="section-head">
            <h2>Coming up this week</h2>
            <Link className="text-link" to="/employee/tasks">
              View all <ArrowUpRight size={16} />
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
                        <span
                          className={`task-mark ${t.category.toLowerCase()}`}
                        >
                          <ListTodo size={17} />
                        </span>
                        <span>
                          {t.title}
                          {risk(t, state) && (
                            <small className="risk-text">
                              {risk(t, state)}
                            </small>
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
        <div className="right-stack">
          <section className="insight-card">
            <span className="eyebrow">
              <Sparkles size={16} />
              MADE FOR YOUR PACE
            </span>
            <h3>
              Your estimates,
              <br />a little more you.
            </h3>
            <p>
              Your recent work patterns help make your next estimate more
              realistic.
            </p>
            <Link className="text-link" to="/employee/capacity">
              See how it works <ArrowRight size={16} />
            </Link>
          </section>
          <section className="assignment-card">
            <div className="section-head">
              <span className="small">
                <span className="tiny-dot" />
                DEMO SCENARIO
              </span>
              <MoreHorizontal size={18} />
            </div>
            <h3>
              {draft
                ? "A new request just came in."
                : "The new request is on your board."}
            </h3>
            <p>Client Competitor Research · 7h</p>
            <button
              className="btn secondary full"
              disabled={busy || !draft}
              onClick={() => run("activate")}
            >
              {draft ? <Plus size={16} /> : <Check size={16} />}{" "}
              {draft ? "Add demo assignment" : "Assignment added"}
            </button>
          </section>
        </div>
      </div>
    </>
  );
}
function TaskRow({ task, state }: { task: Task; state: AppState }) {
  const subs = state.subtasks.filter((s) => s.task_id === task.id),
    done = subs.filter((s) => s.completed).length;
  return (
    <Link className="task-row" to={`/employee/tasks/${task.id}`}>
      <span className={`task-mark ${task.category.toLowerCase()}`}>
        <ListTodo size={19} />
      </span>
      <div className="task-main">
        <strong>{task.title}</strong>
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
        <span>
          {task.status === "completed"
            ? "Completed"
            : subs.length
              ? `${done} / ${subs.length} steps`
              : "Not started"}
        </span>
        <div className="mini-progress">
          <span
            style={{
              width: `${task.status === "completed" ? 100 : subs.length ? (done / subs.length) * 100 : 0}%`,
            }}
          />
        </div>
      </div>
      <ChevronRight size={18} />
    </Link>
  );
}
function TasksPage({ state }: { state: AppState }) {
  const [filter, setFilter] = useState("All");
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
        eyebrow="ONE STEP AT A TIME"
        title="Your work, organized."
        subtitle="Clear tasks. Smaller steps. A plan you can come back to."
      />
      <div className="tabs" role="tablist" aria-label="Filter tasks">
        {["All", "Today", "This Week", "At Risk", "Completed"].map((f) => (
          <button
            role="tab"
            aria-selected={filter === f}
            className={filter === f ? "active" : ""}
            onClick={() => setFilter(f)}
            key={f}
          >
            {f}
          </button>
        ))}
      </div>
      <section className="card task-list">
        {tasks.length ? (
          tasks.map((t) => <TaskRow key={t.id} task={t} state={state} />)
        ) : (
          <div className="empty">
            <CheckCircle2 />
            <h3>Nothing here right now.</h3>
            <p>Try another filter to see the rest of your work.</p>
          </div>
        )}
      </section>
      <p className="caption">
        <ListTodo size={15} />
        These confirmed tasks came from your team’s Monday planning meeting.
      </p>
    </>
  );
}
function TaskDetail({
  state,
  busy,
  run,
}: {
  state: AppState;
  busy: boolean;
  run: Run;
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
        eyebrow={task.category.toUpperCase()}
        title={task.title}
        subtitle={task.description}
      />
      <div className="detail-grid">
        <section className="card">
          <div className="section-head">
            <h2>Your next steps</h2>
            <span className="muted small">
              {subs.filter((s) => s.completed).length} / {subs.length} complete
            </span>
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
                This task is ready to work on. Record your time below when
                you’re ready.
              </p>
            )}
          </div>
          <div className="detail-section">
            <h3>Dependencies</h3>
            {deps.length ? (
              deps.map((d) => (
                <p key={d.prerequisite_id}>
                  {state.tasks.find((t) => t.id === d.prerequisite_id)?.title}
                </p>
              ))
            ) : (
              <p className="muted">No prerequisites. You can get started.</p>
            )}
          </div>
          <div className="detail-section">
            <h3>Time spent</h3>
            <p className="muted">
              Actual time helps personalize estimates for future tasks.
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
                onClick={() =>
                  run("hours", { id, actual_hours: Number(actual) })
                }
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
          </div>
        </section>
        <aside>
          <section className="card task-summary">
            <span className={`priority ${task.priority.toLowerCase()}`}>
              {task.priority} priority
            </span>
            <dl>
              <dt>Deadline</dt>
              <dd>{due(task.deadline)}</dd>
              <dt>Assigned by</dt>
              <dd>Sarah Lee</dd>
              <dt>Status</dt>
              <dd className="capitalize">{task.status.replace("_", " ")}</dd>
            </dl>
            <div className="estimate-block">
              <span>Your personalized estimate</span>
              <strong>
                {hours(task.personalized_hours)}
                <small>h</small>
              </strong>
              <p>
                {hours(task.estimated_hours)}h original ×{" "}
                {task.multiplier.toFixed(2)} adjustment
              </p>
            </div>
            <p className="caption">
              Based on your recent work patterns. This estimate stays fixed
              while the task is active.
            </p>
          </section>
        </aside>
      </div>
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
  return (
    <>
      <PageHeading
        eyebrow="UNDERSTAND YOUR PACE"
        title="Make room for realistic work."
        subtitle="Your capacity is a planning tool, not a measure of your value."
      />
      <div className="capacity-layout">
        <CapacityCard state={state} />
        <section className="card capacity-explainer">
          <div className="section-head">
            <h2>Why 30 hours?</h2>
            <Clock3 size={20} />
          </div>
          <p>
            In a 40-hour week, we leave 10 hours for meetings, admin,
            communication, and breaks.
          </p>
          <div className="week-split">
            <span>30h focus</span>
            <span>10h other</span>
          </div>
          <p className="caption">
            This is a configured starting point for the demo. It isn’t a
            clinical assessment.
          </p>
          {workload(state.tasks) > 30 &&
            !state.negotiations.some((n) =>
              ["pending", "counter_proposed"].includes(n.status),
            ) && (
              <button className="btn primary" onClick={resolve}>
                Resolve workload <ArrowRight size={16} />
              </button>
            )}
        </section>
      </div>
      <section className="card">
        <div className="section-head">
          <h2>Where your capacity goes</h2>
          <div className="role-toggle">
            <button
              className={!next ? "selected" : ""}
              onClick={() => setNext(false)}
            >
              This week
            </button>
            <button
              className={next ? "selected" : ""}
              onClick={() => setNext(true)}
            >
              Next week
            </button>
          </div>
        </div>
        <Breakdown state={state} next={next} />
        <p className="caption">
          Active work due {next ? "next" : "this"} week, plus overdue carryover
          for this week. Full estimates stay counted until tasks are completed;
          logged time does not subtract from this planning total.
        </p>
      </section>
      <section className="learning-section">
        <div className="section-head">
          <h2>
            <Sparkles size={21} />
            Learning your rhythm
          </h2>
          <span className="muted small">From your completed work</span>
        </div>
        <div className="learning-grid">
          {["Research", "Presentation", "Testing", "Analytics", "Design"].map(
            (category) => {
              const m = multiplier(state.history, "alex", category);
              const sample = state.history
                  .filter(
                    (h) => h.employee_id === "alex" && h.category === category,
                  )
                  .slice(0, 10),
                avg = (key: "estimated_hours" | "actual_hours") =>
                  sample.reduce((n, h) => n + h[key], 0) / (sample.length || 1);
              return (
                <div className="card learning-card" key={category}>
                  <span className="learning-category">{category}</span>
                  <strong>
                    {m.value.toFixed(2)}
                    <small>×</small>
                  </strong>
                  <p>Current adjustment</p>
                  <dl>
                    <dt>Original average</dt>
                    <dd>{hours(avg("estimated_hours"))}h</dd>
                    <dt>Your recent average</dt>
                    <dd>{hours(avg("actual_hours"))}h</dd>
                  </dl>
                  <span className="caption">
                    {m.count} samples ·{" "}
                    {m.categorySpecific ? "category" : "overall"} pattern
                  </span>
                </div>
              );
            },
          )}
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
  return (
    <>
      <PageHeading
        eyebrow="A SHARED VIEW OF THE WEEK"
        title="Good morning, Sarah."
        subtitle="See where the team has room, and where a conversation could help."
      >
        <span className="date-chip">
          <CalendarDays size={17} />
          Sep 21 – 27
        </span>
      </PageHeading>
      <div className="stats-grid">
        {[
          ["Team members", employees.length, Users],
          [
            "Capacity conflicts",
            states.filter((s) => s === "Capacity Conflict").length,
            AlertCircle,
          ],
          [
            "Near capacity",
            states.filter((s) => s === "Near Capacity").length,
            Gauge,
          ],
          [
            "Open requests",
            state.negotiations.filter((n) =>
              ["pending", "counter_proposed"].includes(n.status),
            ).length,
            MessageSquare,
          ],
        ].map(([label, value, Icon]) => {
          const I = Icon as typeof Users;
          return (
            <div className="card stat-card" key={String(label)}>
              <span>
                {String(label)}
                <I size={19} />
              </span>
              <strong>{String(value)}</strong>
            </div>
          );
        })}
      </div>
      <div className="section-head team-heading">
        <h2>Everyone’s week</h2>
        <span className="muted small">Sorted by capacity pressure</span>
      </div>
      <div className="team-grid">
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
              className={`card team-card ${load > p.capacity ? "has-conflict" : ""}`}
              to={`/manager/employees/${p.id}`}
              key={p.id}
            >
              <div className="team-person">
                <Avatar name={p.name} large />
                <div>
                  <h3>{p.name}</h3>
                  <p>{p.job_title}</p>
                </div>
                <ArrowUpRight size={19} />
              </div>
              <div className="team-load">
                <strong>
                  {hours(load)}
                  <span> / {p.capacity}h</span>
                </strong>
                <Badge load={load} capacity={p.capacity} />
              </div>
              <Progress load={load} capacity={p.capacity} />
              <div className="team-card-bottom">
                <span>
                  {risks ? `${risks} tasks at risk` : "No tasks at risk"}
                </span>
                <span>
                  {requests
                    ? `${requests} request pending`
                    : `${hours(Math.max(0, p.capacity - load))}h available`}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
      <section className="card request-preview">
        <div className="section-head">
          <h2>Workload requests</h2>
          <Link className="text-link" to="/manager/negotiations">
            View all <ArrowRight size={16} />
          </Link>
        </div>
        {state.negotiations.length ? (
          state.negotiations
            .slice(0, 3)
            .map((n) => <RequestRow key={n.id} n={n} role="manager" />)
        ) : (
          <div className="empty compact-empty">
            <MessageSquare size={25} />
            <p>No requests yet. New conversations will appear here.</p>
          </div>
        )}
      </section>
      <div className="privacy-note">
        <ShieldCheck size={18} />
        <p>
          You see confirmed work, capacity, and shared requests. Personal notes
          and health information are never part of this view.
        </p>
      </div>
    </>
  );
}
function EmployeeDetail({ state }: { state: AppState }) {
  const { id } = useParams(),
    p = state.profiles.find((p) => p.id === id && p.id !== "sarah");
  if (!p) return <NotFound />;
  const load = workload(state.tasks, p.id);
  return (
    <>
      <Link className="back-link" to="/manager/dashboard">
        <ArrowLeft size={16} />
        Back to team overview
      </Link>
      <PageHeading title={p.name} subtitle={p.job_title}>
        <Badge load={load} capacity={p.capacity} />
      </PageHeading>
      <div className="stats-grid three">
        <div className="card stat-card">
          <span>Current workload</span>
          <strong>
            {hours(load)}
            <small>h</small>
          </strong>
        </div>
        <div className="card stat-card">
          <span>Weekly focus capacity</span>
          <strong>
            {p.capacity}
            <small>h</small>
          </strong>
        </div>
        <div className="card stat-card">
          <span>
            {load > p.capacity ? "Above capacity" : "Available capacity"}
          </span>
          <strong>
            {hours(Math.abs(load - p.capacity))}
            <small>h</small>
          </strong>
        </div>
      </div>
      <section className="card">
        <div className="section-head">
          <h2>Confirmed work this week</h2>
          <span className="muted small">Personalized estimates</span>
        </div>
        <Breakdown state={state} employee={p.id} />
      </section>
      <section className="card request-preview">
        <h2>Shared workload requests</h2>
        {state.negotiations
          .filter((n) => n.employee_id === p.id)
          .map((n) => (
            <RequestRow key={n.id} n={n} role="manager" />
          ))}
        {!state.negotiations.some((n) => n.employee_id === p.id) && (
          <p className="muted">No requests for this teammate.</p>
        )}
      </section>
    </>
  );
}
function RequestRow({ n, role }: { n: Negotiation; role: Role }) {
  return (
    <Link className="request-row" to={`/${role}/negotiations/${n.id}`}>
      <span className="request-icon">
        <MessageSquare size={20} />
      </span>
      <div>
        <strong>{n.proposal.label}</strong>
        <span>Alex Morgan · Sarah Lee · Revision {n.revision}</span>
      </div>
      <span
        className={`badge ${n.status === "approved" ? "good" : n.status === "declined" ? "neutral" : "warning"}`}
      >
        {n.status.replace("_", " ")}
      </span>
      <ChevronRight size={18} />
    </Link>
  );
}
function Requests({
  state,
  role,
  resolve,
}: {
  state: AppState;
  role: Role;
  resolve: () => void;
}) {
  const [filter, setFilter] = useState("All");
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
        eyebrow="A CONVERSATION, NOT A COMPROMISE"
        title="Let’s make the workload work."
        subtitle="A shared place to discuss priorities and agree on a realistic plan."
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
      <div className="tabs">
        {["All", "Open", "Closed"].map((f) => (
          <button
            className={filter === f ? "active" : ""}
            onClick={() => setFilter(f)}
            key={f}
          >
            {f}
          </button>
        ))}
      </div>
      <section className="card">
        {list.length ? (
          list.map((n) => <RequestRow key={n.id} n={n} role={role} />)
        ) : (
          <div className="empty">
            <MessageSquare size={32} />
            <h3>A little conversation can make room.</h3>
            <p>
              No {filter === "All" ? "" : filter.toLowerCase() + " "}requests
              yet. If your workload exceeds capacity, start from Resolve
              Workload.
            </p>
          </div>
        )}
      </section>
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
          <CalendarDays size={15} />
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
          <Users size={15} />
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
              <strong>{o.label}</strong>
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
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <MessageSquare size={16} />
              )}{" "}
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
        eyebrow="ALEX MORGAN ↔ SARAH LEE"
        title={n.proposal.label}
        subtitle={`Revision ${n.revision} · ${n.status.replace("_", " ")}`}
      />
      <div className="detail-grid">
        <section className="card">
          <h2>The proposed adjustment</h2>
          {open ? (
            <ProposalImpact state={state} proposal={n.proposal} />
          ) : (
            <div className="resolved-summary">
              <CheckCircle2 size={25} />
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
        <section className="card">
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
      </div>
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
