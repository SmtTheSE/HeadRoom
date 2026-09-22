import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
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
  ChartNoAxesColumn,
  Folder,
  House,
  ArrowRight,
  Check,
  ChevronDown,
  Gauge,
  LayoutDashboard,
  ListTodo,
  LoaderCircle,
  LogOut,
  SlidersHorizontal,
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
import { applyDisplay, readDisplay, type Display } from "./display";
import { previewState } from "./seed";
import {
  active,
  applyPreview,
  due,
  dueRelative,
  duration,
  durationMinutes,
  multiplier,
  person,
  recommendations,
  risk,
  status,
  workload,
  WEEK_END,
} from "./domain";
import type { AppState, Negotiation, Proposal, Role, Task } from "./types";

type Undo = () => Promise<boolean> | boolean | void;
type Run = (
  op: string,
  payload?: Record<string, unknown>,
  message?: string,
  undo?: Undo,
) => Promise<boolean>;
type Notify = (text: string, undo?: Undo) => void;
type Breakdown = (task: Task) => Promise<boolean>;
type AiState = { taskId: string; phase: "working" | "done" } | null;
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
      from: `${duration(task.personalized_hours)}`,
      to: `${duration(Math.max(0, task.personalized_hours - p.scope_hours!))}`,
    };
  return {
    title,
    change: "Assignee",
    from: person(state, task.employee_id).name.split(" ")[0],
    to: person(state, p.employee_id!).name.split(" ")[0],
  };
}
/** "counter_proposed" → "Counter proposed" */
function sentence(value: string) {
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
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
/* ---------- display preferences ---------- */
const DisplayContext = createContext<{
  display: Display;
  update: (patch: Partial<Display>) => void;
}>({ display: readDisplay(), update: () => {} });
const useDisplay = () => useContext(DisplayContext);
function DisplayButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={`btn ghost display-btn ${className}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <SlidersHorizontal size={15} />
        Display
      </button>
      {open && <DisplayPanel onClose={() => setOpen(false)} />}
    </>
  );
}
function DisplayPanel({ onClose }: { onClose: () => void }) {
  const { display, update } = useDisplay();
  const [announce, setAnnounce] = useState("");
  const set = (patch: Partial<Display>, message: string) => {
    update(patch);
    setAnnounce(message);
  };
  const Switch = ({
    id,
    on,
    onChange,
  }: {
    id: string;
    on: boolean;
    onChange: (next: boolean) => void;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={id}
      className={`llm-switch ${on ? "is-on" : ""}`}
      onClick={() => onChange(!on)}
    >
      <span>{on ? "On" : "Off"}</span>
      <i aria-hidden="true" />
    </button>
  );
  return (
    <Modal title="Display preferences" onClose={onClose}>
      <p className="muted">
        These apply to this browser only and take effect immediately.
      </p>
      <div className="display-rows">
        <div className="llm-setting">
          <div>
            <div className="setting-title" id="pref-motion">
              Motion
            </div>
            <div className="setting-subtitle">
              Animations while the AI works and when steps appear. “System”
              follows your device setting.
            </div>
          </div>
          <Segmented
            label="Motion"
            options={["System", "Reduce", "Allow"] as const}
            value={
              display.motion === "reduce"
                ? "Reduce"
                : display.motion === "allow"
                  ? "Allow"
                  : "System"
            }
            onChange={(v) =>
              set(
                {
                  motion:
                    v === "Reduce"
                      ? "reduce"
                      : v === "Allow"
                        ? "allow"
                        : "system",
                },
                `Motion set to ${v.toLowerCase()}`,
              )
            }
          />
        </div>
        <div className="llm-setting">
          <div>
            <div className="setting-title" id="pref-text">
              Text size
            </div>
            <div className="setting-subtitle">
              Scales the whole interface. Layout reflows; nothing is cut off.
            </div>
          </div>
          <Segmented
            label="Text size"
            options={["Default", "Large", "Larger"] as const}
            value={
              display.text === "large"
                ? "Large"
                : display.text === "larger"
                  ? "Larger"
                  : "Default"
            }
            onChange={(v) =>
              set(
                {
                  text:
                    v === "Large"
                      ? "large"
                      : v === "Larger"
                        ? "larger"
                        : "default",
                },
                `Text size ${v.toLowerCase()}`,
              )
            }
          />
        </div>
        <div className="llm-setting">
          <div>
            <div className="setting-title" id="pref-contrast">
              High contrast
            </div>
            <div className="setting-subtitle">
              Black text, solid borders, no tinted backgrounds.
            </div>
          </div>
          <Switch
            id="pref-contrast"
            on={display.contrast}
            onChange={(on) =>
              set({ contrast: on }, `High contrast ${on ? "on" : "off"}`)
            }
          />
        </div>
        <div className="llm-setting">
          <div>
            <div className="setting-title" id="pref-simple">
              Simplified view
            </div>
            <div className="setting-subtitle">
              Shows only today’s focus and your capacity. Upcoming work,
              explanations, and the Teams inbox are collapsed.
            </div>
          </div>
          <Switch
            id="pref-simple"
            on={display.simple}
            onChange={(on) =>
              set({ simple: on }, `Simplified view ${on ? "on" : "off"}`)
            }
          />
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <div className="modal-actions">
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
/** Confirmation for destructive or irreversible actions. */
function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  onConfirm: () => Promise<boolean> | boolean;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted">{children}</p>
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className={`btn ${danger ? "danger" : "primary"}`}
          disabled={busy}
          onClick={async () => {
            if (await onConfirm()) onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
/* ---------- urgency ---------- */
const PRIORITY_RANK: Record<Task["priority"], number> = {
  High: 0,
  Medium: 1,
  Low: 2,
};
/** Sooner deadline first, then higher priority. */
function byUrgency(a: Task, b: Task) {
  return (
    a.deadline.localeCompare(b.deadline) ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  );
}
function dueTone(iso: string, demoDate: string) {
  const label = dueRelative(iso, demoDate);
  return label.includes("overdue") || label === "Today"
    ? "danger"
    : label === "Tomorrow"
      ? "warning"
      : "neutral";
}
/** Deadline as a chip whose weight matches how soon it is. */
function DueChip({ iso, demoDate }: { iso: string; demoDate: string }) {
  const label = dueRelative(iso, demoDate);
  return (
    <span className={`due-chip ${dueTone(iso, demoDate)}`}>
      {label.includes("overdue")
        ? label
        : `Due ${label === "Today" || label === "Tomorrow" ? label.toLowerCase() : label}`}
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
  // The element that opened the dialog, captured once at creation.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    ref.current?.showModal();
    // Restore focus after the dialog node is gone; removing an open modal
    // otherwise resets focus to <body>.
    return () => {
      setTimeout(() => opener?.focus?.(), 0);
    };
  }, [opener]);
  return (
    <dialog
      className="modal"
      ref={ref}
      onCancel={onClose}
      onClose={onClose}
      aria-labelledby="modal-title"
    >
      <div className="modal-head">
        <h2 id="modal-title">{title}</h2>
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
      undo?: Undo;
    } | null>(null),
    [resetOpen, setResetOpen] = useState(false);
  const [llmApiEnabled, setLlmApiEnabled] = useState(() => {
    try {
      return localStorage.getItem("headroom.llm-api") === "on";
    } catch {
      return false;
    }
  });
  function toggleLlmApi() {
    const next = !llmApiEnabled;
    setLlmApiEnabled(next);
    try {
      localStorage.setItem("headroom.llm-api", next ? "on" : "off");
    } catch {
      /* Keep the preference for this session. */
    }
  }
  const [compose, setCompose] = useState<{
    mode: "request" | "counter" | "revise";
    request?: Negotiation;
  } | null>(null);
  const setNotice = (
    text: string,
    tone: "success" | "error" = "success",
    undo?: Undo,
  ) => setNoticeState(text ? { text, tone, undo } : null);
  const notify: Notify = (text, undo) => setNotice(text, "success", undo);
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
            "Sign-in could not be restored. Please try again.",
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
    const path = location.pathname;
    const page =
      path === "/sign-in"
        ? "Sign in"
        : path.includes("/focus/")
          ? "Focus"
          : path.includes("/capacity")
            ? "My capacity"
            : path.includes("/tasks/")
              ? "Task"
              : path.includes("/tasks")
                ? "My tasks"
                : path.includes("/negotiations/")
                  ? "Workload request"
                  : path.includes("/negotiations")
                    ? "Workload requests"
                    : path.includes("/employees/")
                      ? "Team member"
                      : path.startsWith("/manager")
                        ? "Team overview"
                        : "My overview";
    document.title = `${page} · Headroom`;
  }, [location.pathname]);
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
    if (!notice || notice.tone === "error") return;
    const timer = setTimeout(() => setNotice(""), notice.undo ? 12000 : 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  // Undo closures are created before their action completes, so they must
  // read the workspace version at call time, not the one they captured.
  const latest = useRef(query.data);
  latest.current = query.data;
  const run: Run = async (op, payload = {}, message, undo) => {
    if (!session) {
      navigate("/sign-in");
      return false;
    }
    const current =
      cache.getQueryData<AppState>(["workspace", session.user.id]) ??
      latest.current;
    if (!current) {
      setNotice("The workspace is still loading. Please try again.", "error");
      return false;
    }
    setBusy(true);
    try {
      const updated = await action(
        op,
        { ...payload, role },
        current.workspace.version,
      );
      cache.setQueryData(["workspace", session.user.id], updated);
      if (op === "reset") {
        localStorage.removeItem(DISMISSED_KEY);
        localStorage.removeItem(WELCOMED_KEY);
      }
      setNotice(
        message ??
          (op === "request"
            ? "Request sent to Sarah Lee for review."
            : op === "approve" || op === "accept"
              ? "Adjustment applied. Workload updated."
              : op === "reset"
                ? "Demo workspace reset to its starting state."
                : "Changes saved."),
        "success",
        undo,
      );
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Changes could not be saved. Please try again.",
        "error",
      );
      void query.refetch();
      return false;
    } finally {
      setBusy(false);
    }
  };
  const [ai, setAi] = useState<AiState>(null);
  const [display, setDisplay] = useState<Display>(readDisplay);
  const updateDisplay = (patch: Partial<Display>) =>
    setDisplay((d) => {
      const next = { ...d, ...patch };
      applyDisplay(next);
      return next;
    });
  const runBreakdown: Breakdown = async (task) => {
    if (!session) {
      navigate("/sign-in");
      return false;
    }
    if (!query.data) {
      setNotice("The workspace is still loading. Please try again.", "error");
      return false;
    }
    setBusy(true);
    setAi({ taskId: task.id, phase: "working" });
    try {
      const { steps, model, source } = await generateSteps(
        task,
        query.data.workspace.version,
        llmApiEnabled,
      );
      const updated = await saveBreakdown(
        task.id,
        steps,
        (
          cache.getQueryData<AppState>(["workspace", session.user.id]) ??
          query.data
        ).workspace.version,
      );
      cache.setQueryData(["workspace", session.user.id], updated);
      setAi({ taskId: task.id, phase: "done" });
      setTimeout(() => setAi(null), 8000);
      setNotice(
        source === "mock"
          ? `Demo breakdown added ${steps.length} steps to ${task.title}. LLM API is off.`
          : `Gemini generated ${steps.length} steps for ${task.title}. Model: ${model}.`,
      );
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The task could not be broken down. Please try again.",
        "error",
      );
      setAi(null);
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
      {notice.undo && (
        <button
          className="toast-action"
          onClick={async () => {
            const undo = notice.undo!;
            setNotice("");
            await undo();
          }}
        >
          Undo
        </button>
      )}
      <button onClick={() => setNotice("")} aria-label="Dismiss message">
        <X size={16} />
      </button>
    </div>
  );
  const provider = (children: ReactNode) => (
    <DisplayContext.Provider value={{ display, update: updateDisplay }}>
      {children}
    </DisplayContext.Provider>
  );
  if (location.pathname === "/sign-in")
    return provider(
      <>
        <SignInPage state={state} busy={busy || !ready} onGoogle={signIn} />
        {toast}
      </>,
    );
  if (location.pathname.startsWith("/employee/focus/"))
    return provider(
      <>
        <FocusPage
          state={state}
          busy={busy}
          run={run}
          stepId={location.pathname.split("/").pop() ?? ""}
        />
        {toast}
      </>,
    );
  return provider(
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link className="brand" to={`/${role}/dashboard`}>
          <img className="brand-mark" src="/logo.svg" alt="" />
          headroom<span className="brand-period">.</span>
        </Link>
        <nav aria-label="Main">
          <NavLink to={`/${role}/dashboard`}>
            <House size={18} />
            {role === "employee" ? "My overview" : "Team overview"}
          </NavLink>
          {role === "employee" && (
            <>
              <NavLink to="/employee/tasks">
                <Folder size={18} />
                My tasks
              </NavLink>
              <NavLink to="/employee/capacity">
                <ChartNoAxesColumn size={18} />
                My capacity
              </NavLink>
            </>
          )}
          <NavLink to={`/${role}/negotiations`}>
            <MessageSquare size={18} />
            Workload requests
            {pending > 0 && <span className="nav-count">{pending}</span>}
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <DisplayButton className="sidebar-display" />
          <div id="profile-settings" popover="auto" className="profile-popover">
            <div className="llm-setting">
              <div>
                <div className="setting-title">Demo workspace</div>
                <div className="setting-subtitle">
                  Restore the sample tasks, time entries, and requests.
                </div>
              </div>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => setResetOpen(true)}
              >
                <RotateCcw size={14} />
                Reset
              </button>
            </div>
            <div className="llm-setting">
              <div>
                <div className="setting-title" id="llm-api-label">
                  AI task breakdown
                </div>

                <div className="setting-subtitle">
                  {llmApiEnabled
                    ? "Use Gemini to generate task steps."
                    : "Use local demonstration steps."}
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={llmApiEnabled}
                aria-labelledby="llm-api-label"
                className={`llm-switch ${llmApiEnabled ? "is-on" : ""}`}
                onClick={toggleLlmApi}
                disabled={busy}
              >
                <span>{llmApiEnabled ? "On" : "Off"}</span>
                <i aria-hidden="true" />
              </button>
            </div>
          </div>
          {session ? (
            <div className="profile-mini">
              <button
                className="profile-trigger"
                popoverTarget="profile-settings"
                aria-label="Open profile settings"
              >
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
                <span className="profile-copy">
                  <strong>
                    {session.user.user_metadata.full_name ??
                      session.user.user_metadata.name ??
                      session.user.email}
                  </strong>
                  <small>{p.job_title}</small>
                </span>
              </button>
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
              <button
                className="profile-trigger"
                popoverTarget="profile-settings"
                aria-label="Open profile settings"
              >
                <Avatar name={p.name} />
                <span className="profile-copy">
                  <strong>{p.name}</strong>
                  <small>{p.job_title} · sample</small>
                </span>
              </button>
            </div>
          )}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="topbar-status">
            {session
              ? "Demo workspace"
              : "Sample workspace · Sign in to save changes"}
          </span>
          <div className="top-actions">
            <DisplayButton className="topbar-display" />
            <div className="view-as">
              <span id="view-as-label">Viewing as</span>
              <Segmented
                label="Viewing as"
                options={["Employee", "Manager"] as const}
                value={role === "employee" ? "Employee" : "Manager"}
                onChange={(v) =>
                  changeRole(v === "Employee" ? "employee" : "manager")
                }
              />
            </div>
            {!session && (
              <Link className="btn secondary" to="/sign-in">
                Sign in
              </Link>
            )}
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {ready && session && query.isError ? (
            <div className="connection-error">
              <h1>Unable to connect to your workspace</h1>
              <p>
                {query.error.message.includes("headroom_state")
                  ? "The Headroom database schema is not installed. Run the SQL setup in your Supabase project, then retry."
                  : query.error.message}
              </p>
              <button className="btn primary" onClick={() => query.refetch()}>
                Retry connection
              </button>
            </div>
          ) : !ready || (session && query.isPending) ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              <p>Loading your workspace…</p>
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
                    notify={notify}
                    resolve={() => setCompose({ mode: "request" })}
                    userName={firstName(session, "Alex")}
                  />
                }
              />
              <Route
                path="/employee/tasks"
                element={
                  <TasksPage
                    state={state}
                    busy={busy}
                    ai={ai}
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
                    ai={ai}
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
                element={
                  <ManagerDashboard
                    state={state}
                    userName={firstName(session, "Sarah")}
                  />
                }
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
        <ConfirmDialog
          title="Reset demo workspace?"
          confirmLabel="Reset demo"
          busy={busy}
          onConfirm={() => run("reset")}
          onClose={() => setResetOpen(false)}
        >
          This restores the sample tasks, time entries, and requests to the
          starting workload of 27 / 30h. Only your demo workspace is affected.
        </ConfirmDialog>
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
    </div>,
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
  const load = workload(state.tasks, "alex", false, state.subtasks),
    p = person(state, "alex");
  const steps = state.subtasks.filter((s) => !s.completed).slice(0, 3);
  return (
    <div className="signin">
      <header className="signin-top">
        <Link className="brand" to="/employee/dashboard">
          <img className="brand-mark" src="/logo.svg" alt="" />
          headroom<span className="brand-period">.</span>
        </Link>
        <DisplayButton />
      </header>
      <main className="signin-main">
        <section className="signin-copy">
          <h1>Make room for what matters</h1>
          <p className="signin-sub">The AI workspace that plans by capacity</p>
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
              Continue with sample workspace
              <ArrowRight size={16} />
            </Link>
            <p className="fine-print">
              Signing in creates a private demo workspace with sample data.
              Google is used for authentication only; Headroom does not access
              your email or calendar.
            </p>
          </div>
        </section>
        <aside className="signin-visual" aria-hidden="true">
          <div className="preview-card">
            <span className="capacity-label">This week</span>
            <div className="capacity-number">
              {duration(load)}
              <span> / {p.capacity}h</span>
            </div>
            <Progress load={load} capacity={p.capacity} dark />
            <p className="capacity-note">
              <strong>{duration(p.capacity - load)} available.</strong> Reserved
              time covers meetings, administration, and breaks.
            </p>
          </div>
          <div className="preview-list">
            {steps.map((s, i) => (
              <div className="preview-row" key={s.id}>
                <span className={`check-circle ${i === 0 ? "first" : ""}`} />
                <span>{s.title}</span>
                <small>{minutesLabel(s.minutes)}</small>
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
/** Real wall-clock time, refreshed every minute. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
function greeting(now: Date) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
const longDate = new Intl.DateTimeFormat("en", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const clock = new Intl.DateTimeFormat("en", {
  hour: "numeric",
  minute: "2-digit",
});
/** First name of the signed-in account, or the sample persona when signed out. */
function firstName(session: Session | null, fallback: string) {
  const full: string | undefined =
    session?.user.user_metadata.full_name ??
    session?.user.user_metadata.name ??
    session?.user.email;
  return (full ?? fallback).split(/[\s@]/)[0];
}
/* ---------- focus mode ---------- */
const BLOCK_MIN = 25;
const FOCUS_KEY = "headroom.focus";
type FocusTimer = {
  id: string;
  startedAt: number;
  accumulated: number;
  pausedAt: number | null;
};
function readFocus(id: string): FocusTimer {
  try {
    const t = JSON.parse(
      localStorage.getItem(FOCUS_KEY) ?? "null",
    ) as FocusTimer | null;
    if (t && t.id === id) return t;
  } catch {
    /* ignore */
  }
  return { id, startedAt: Date.now(), accumulated: 0, pausedAt: null };
}
function minutesLabel(minutes: number) {
  return durationMinutes(minutes);
}
function clockLabel(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60),
    sec = total % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
/** Toast text after ticking a step: what was done and what comes next. */
function stepDoneMessage(
  list: { id: string; title: string; completed: boolean; minutes: number }[],
  id: string,
) {
  const step = list.find((x) => x.id === id);
  if (!step || step.completed) return "Step reopened.";
  const remaining = list.filter((x) => !x.completed && x.id !== id);
  return remaining.length
    ? `${step.title} done. Next: ${remaining[0].title} (${minutesLabel(remaining[0].minutes)}).`
    : `${step.title} done. That was the last step.`;
}
function FocusPage({
  state,
  busy,
  run,
  stepId,
}: {
  state: AppState;
  busy: boolean;
  run: Run;
  stepId: string;
}) {
  const navigate = useNavigate();
  const step = state.subtasks.find((x) => x.id === stepId),
    task = step && state.tasks.find((t) => t.id === step.task_id);
  const queue = state.subtasks.filter(
    (x) =>
      !x.completed &&
      state.tasks.some(
        (t) => t.id === x.task_id && active(t) && t.employee_id === "alex",
      ),
  );
  const next = queue.find((x) => x.id !== stepId);
  const doneToday = state.subtasks.filter(
    (x) => x.completed && task && x.task_id === task.id,
  ).length;
  const [timer, setTimer] = useState<FocusTimer>(() => readFocus(stepId));
  const now = useTick(timer.pausedAt === null);
  const [justDone, setJustDone] = useState(false);
  useEffect(() => {
    localStorage.setItem(FOCUS_KEY, JSON.stringify(timer));
  }, [timer]);
  if (!step || !task) return <NotFound />;
  const elapsed =
    timer.accumulated + (timer.pausedAt === null ? now - timer.startedAt : 0);
  const blockMs = BLOCK_MIN * 60000,
    plannedMs = step.minutes * 60000,
    blocks = Math.max(1, Math.ceil(step.minutes / BLOCK_MIN)),
    block = Math.min(blocks, Math.floor(elapsed / blockMs) + 1),
    inBlock = elapsed - (block - 1) * blockMs,
    blockEnd =
      inBlock >= blockMs && block === blocks && elapsed < plannedMs + 1;
  const over = elapsed > plannedMs;
  const pause = () =>
    setTimer((t) =>
      t.pausedAt === null
        ? {
            ...t,
            accumulated: t.accumulated + (Date.now() - t.startedAt),
            pausedAt: Date.now(),
          }
        : { ...t, startedAt: Date.now(), pausedAt: null },
    );
  const finish = async () => {
    if (
      await run(
        "subtask",
        { id: step.id },
        stepDoneMessage(queue, step.id),
        () => run("subtask", { id: step.id }, "Step reopened."),
      )
    ) {
      localStorage.removeItem(FOCUS_KEY);
      setJustDone(true);
    }
  };
  const startNext = (id: string) => {
    localStorage.removeItem(FOCUS_KEY);
    setJustDone(false);
    setTimer({ id, startedAt: Date.now(), accumulated: 0, pausedAt: null });
    navigate(`/employee/focus/${id}`);
  };
  if (step.completed || justDone)
    return (
      <div className="focus">
        <header className="focus-top">
          <Link to="/employee/dashboard">Exit focus</Link>
          <DisplayButton />
        </header>
        <main className="focus-main focus-done" id="main" tabIndex={-1}>
          <span className="overline">Step complete</span>
          <h1>{step.title}</h1>
          <p className="focus-parent">
            {doneToday} of{" "}
            {doneToday + queue.filter((x) => x.task_id === task.id).length}{" "}
            steps done on {task.title}
          </p>
          {next ? (
            <div className="focus-next">
              <span className="muted">Up next</span>
              <strong>{next.title}</strong>
              <span className="muted">
                {state.tasks.find((t) => t.id === next.task_id)?.title} ·{" "}
                {minutesLabel(next.minutes)}
              </span>
              <div className="focus-actions">
                <button
                  className="btn primary"
                  onClick={() => startNext(next.id)}
                >
                  Start next step
                </button>
                <Link className="btn secondary" to="/employee/dashboard">
                  Back to overview
                </Link>
              </div>
            </div>
          ) : (
            <div className="focus-next">
              <strong>No steps left today.</strong>
              <div className="focus-actions">
                <Link className="btn primary" to="/employee/dashboard">
                  Back to overview
                </Link>
              </div>
            </div>
          )}
        </main>
      </div>
    );
  return (
    <div className="focus">
      <header className="focus-top">
        <Link to="/employee/dashboard">Exit focus</Link>
        <span className="focus-top-right">
          <span className="muted">
            {queue.length - 1} more step{queue.length === 2 ? "" : "s"} after
            this
          </span>
          <DisplayButton />
        </span>
      </header>
      <main className="focus-main" id="main" tabIndex={-1}>
        <p className="focus-parent">
          <span className="current-label">Main task:</span>
          <Link to={`/employee/tasks/${task.id}`}>{task.title}</Link>
          <span className="bullet" aria-hidden="true">
            ·
          </span>
          <DueChip iso={task.deadline} demoDate={state.workspace.demo_date} />
        </p>
        <h1>{step.title}</h1>
        <div
          className="focus-timer"
          role="timer"
          aria-live="off"
          aria-label={`${clockLabel(inBlock)} of ${BLOCK_MIN} minutes in this block`}
        >
          <span className="focus-clock">
            {clockLabel(Math.min(inBlock, blockMs))}
          </span>
          <span className="focus-of"> / {BLOCK_MIN}:00</span>
        </div>
        <div className="progress focus-bar" aria-hidden="true">
          <span
            style={{ width: `${Math.min(100, (inBlock / blockMs) * 100)}%` }}
          />
        </div>
        <p className="focus-block">
          {blocks > 1 ? `Block ${block} of ${blocks} · ` : ""}
          planned {minutesLabel(step.minutes)} · {clockLabel(elapsed)} so far
          {timer.pausedAt !== null && " · paused"}
        </p>
        {blockEnd && !over && (
          <p className="focus-note" role="status">
            Block done. A short break is fine — then keep going.
          </p>
        )}
        {over && (
          <p className="focus-note" role="status">
            Over the planned time. That happens. Finish, or split what is left
            into a new step.
          </p>
        )}
        <div className="focus-actions">
          <button className="btn primary" disabled={busy} onClick={finish}>
            <Check size={16} />
            Done
          </button>
          <button className="btn secondary" onClick={pause}>
            {timer.pausedAt === null ? "Pause" : "Resume"}
          </button>
          {next && (
            <button className="btn ghost" onClick={() => startNext(next.id)}>
              Skip to next
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
/** Re-renders once a second while `running`. */
function useTick(running: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return now;
}
function PageHeading({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
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
    load = workload(state.tasks, employee, false, state.subtasks),
    over = load > p.capacity,
    onCapacityPage = useLocation().pathname.endsWith("/capacity");
  return (
    <section className="capacity-hero" aria-label="This week’s workload">
      <div className="capacity-figure">
        <span className="capacity-label">This week</span>
        <div className="capacity-number">
          {duration(load)}
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
              ? `${duration(load - p.capacity)} over capacity.`
              : `${duration(p.capacity - load)} available.`}
          </strong>{" "}
          {over
            ? "Review adjustment options to bring this week within capacity."
            : "Reserved time covers meetings, administration, and breaks."}
        </p>
      </div>
      {!onCapacityPage && (
        <Link className="capacity-link" to="/employee/capacity">
          Details
        </Link>
      )}
    </section>
  );
}
function Dashboard({
  state,
  busy,
  run,
  notify,
  resolve,
  userName,
}: {
  state: AppState;
  busy: boolean;
  run: Run;
  notify: Notify;
  resolve: () => void;
  userName: string;
}) {
  const now = useNow();
  const [welcomed, setWelcomed] = useState(
    () => localStorage.getItem(WELCOMED_KEY) === "1",
  );
  const load = workload(state.tasks, "alex", false, state.subtasks),
    open = state.negotiations.find((n) =>
      ["pending", "counter_proposed"].includes(n.status),
    );
  const tasks = state.tasks
    .filter((t) => t.employee_id === "alex" && active(t))
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  const urgentTasks = state.tasks
    .filter((t) => active(t) && t.employee_id === "alex")
    .sort(byUrgency);
  const focus = urgentTasks
    .flatMap((t) =>
      state.subtasks.filter((s) => s.task_id === t.id && !s.completed),
    )
    .slice(0, 3);
  const resolved =
    state.negotiations.some((n) => n.status === "approved") && load <= 30;
  return (
    <>
      <PageHeading
        eyebrow={`${longDate.format(now)} · ${clock.format(now)}`}
        title={`${greeting(now)}, ${userName}.`}
      />
      {focus[0] && !welcomed && (
        <div className="wayfinding" role="region" aria-label="Where to start">
          <p>
            Start with <strong>{focus[0].title}</strong> — your first step today
            ({minutesLabel(focus[0].minutes)}).
          </p>
          <Link className="btn primary" to={`/employee/focus/${focus[0].id}`}>
            Start
          </Link>
          <button
            className="icon-btn"
            aria-label="Dismiss this hint"
            onClick={() => {
              localStorage.setItem(WELCOMED_KEY, "1");
              setWelcomed(true);
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <TaskInbox state={state} busy={busy} run={run} notify={notify} />
      {resolved && (
        <div className="banner success">
          <div>
            <strong>Capacity conflict resolved.</strong>
            <span>
              The approved adjustment has been applied to your workload.
            </span>
          </div>
          <Link to="/employee/negotiations">
            View agreement <ArrowRight size={16} />
          </Link>
        </div>
      )}
      {load > 30 && (
        <div className="banner conflict">
          <div>
            <strong>This week exceeds your capacity.</strong>
            <span>
              Workload is {duration(load - 30)} over capacity. Review adjustment
              options with your superior.
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
          <span className="muted">{focus.length} steps</span>
        </div>
        <div className="focus-list">
          {focus.length ? (
            focus.map((s, i) => (
              <div className="focus-item" key={s.id}>
                <button
                  aria-label={`Complete ${s.title}`}
                  className={`check-circle ${i === 0 ? "first" : ""}`}
                  disabled={busy}
                  onClick={() =>
                    run(
                      "subtask",
                      { id: s.id },
                      stepDoneMessage(focus, s.id),
                      () => run("subtask", { id: s.id }, "Step reopened."),
                    )
                  }
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
                <span className="time-pill">{minutesLabel(s.minutes)}</span>
                {i === 0 ? (
                  <Link
                    className={`btn ${welcomed ? "primary" : "secondary"} start-btn`}
                    to={`/employee/focus/${s.id}`}
                  >
                    Start
                  </Link>
                ) : (
                  <span className="step-order">
                    {i === 1 ? "Next" : "Then"}
                  </span>
                )}
              </div>
            ))
          ) : (
            <div className="empty">
              <p>All focus steps are complete.</p>
              <Link to="/employee/tasks">View tasks</Link>
            </div>
          )}
        </div>
      </section>
      <section className="section optional">
        <div className="section-head">
          <h2>Due this week</h2>
          <Link
            className="text-link"
            to="/employee/tasks"
            aria-label="View all tasks"
          >
            View all
          </Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Due</th>
                <th>Estimate</th>
              </tr>
            </thead>
            <tbody>
              {tasks.slice(0, 4).map((t) => (
                <tr key={t.id} className={`prio-${t.priority.toLowerCase()}`}>
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
                  <td>
                    <DueChip
                      iso={t.deadline}
                      demoDate={state.workspace.demo_date}
                    />
                  </td>
                  <td>{duration(t.personalized_hours)}</td>
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
  { from: string; channel: string; text: string }
> = {
  "new-research": {
    from: "Sarah Lee",
    channel: "Design team",
    text: "Hi Alex, please prepare a competitor research summary for the client pitch. Cover the three main competitors’ pricing pages and onboarding flows, and include screenshots we can use in the deck. Please have it ready by Thursday morning so it can be reviewed before the call. Thank you.",
  },
};
const DISMISSED_KEY = "headroom.dismissed";
const WELCOMED_KEY = "headroom.welcomed";
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
  notify,
}: {
  state: AppState;
  busy: boolean;
  run: Run;
  notify: Notify;
}) {
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const [openId, setOpenId] = useState<string | null>(null);
  const [receivedAt] = useState(() => new Date());
  const [showAll, setShowAll] = useState(false);
  const drafts = state.tasks.filter(
    (t) =>
      t.employee_id === "alex" &&
      t.status === "draft" &&
      !dismissed.includes(t.id),
  );
  if (!drafts.length) return null;
  if (!showAll)
    return (
      <div className="inbox-collapsed">
        <TeamsMark />
        <span>
          <strong>
            {drafts.length} potential task{drafts.length === 1 ? "" : "s"}
          </strong>{" "}
          from Microsoft Teams
        </span>
        <button
          className="btn secondary"
          onClick={() => setShowAll(true)}
          aria-expanded={false}
        >
          Show
        </button>
      </div>
    );
  const persist = (next: string[]) => {
    setDismissed(next);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  };
  const dismiss = (id: string) => {
    const title = drafts.find((t) => t.id === id)?.title ?? "Task";
    persist([...dismissed, id]);
    notify(`${title} removed — not a task.`, () => {
      persist(dismissed.filter((x) => x !== id));
    });
  };
  return (
    <section className="inbox" aria-label="Potential new tasks">
      {drafts.map((t) => {
        const m = TEAMS_MESSAGES[t.id] ?? {
          from: "Sarah Lee",
          channel: "Design team",
          text: t.description,
        };
        const expanded = openId === t.id;
        return (
          <section className="inbox-item" key={t.id}>
            <div className="inbox-main">
              <span className="inbox-source">
                Microsoft Teams · {m.from} in {m.channel} · Today,{" "}
                {clock.format(receivedAt)}
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
                  Confirming adds <b>{t.title}</b> ·{" "}
                  {duration(t.personalized_hours)} estimate · due{" "}
                  {due(t.deadline, true)}
                  <span className="inbox-scope">
                    Detected from a message that mentions you. Nothing is added
                    to your workload until you confirm; removing it deletes it.
                  </span>
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
    </section>
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
/* AI working experience. While the model runs: an aurora border, an orb with
   orbiting satellites, a reasoning-trace list of phases that tick off, an
   indeterminate progress sweep, and skeleton rows. When steps arrive they are
   typed out one after another with a live caret. */
const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/* Claude's rotating status verbs. */
const AI_WORDS = [
  "Thinking",
  "Pondering",
  "Reasoning",
  "Considering",
  "Drafting",
  "Refining",
  "Synthesizing",
  "Finalizing",
];
function useAiWord() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % AI_WORDS.length), 1400);
    return () => clearInterval(t);
  }, []);
  return AI_WORDS[i];
}
function AiBadge() {
  const word = useAiWord();
  return (
    <span className="ai-badge">
      <span className="ai-shimmer" key={word}>
        {word}…
      </span>
    </span>
  );
}
function AiOrb({ small = false }: { small?: boolean }) {
  return (
    <span className={`ai-orb ${small ? "small" : ""}`} aria-hidden="true">
      <span className="ai-orbit" />
      <span className="ai-orbit second" />
    </span>
  );
}
function AiLabel() {
  const word = useAiWord();
  return (
    <>
      <AiOrb small />
      <span className="ai-shimmer" key={word}>
        {word}…
      </span>
    </>
  );
}
function AiWorking() {
  return (
    <div className="ai-panel" role="status" aria-live="polite">
      <div className="ai-bar" aria-hidden="true">
        <span />
      </div>
      <div className="ai-head">
        <AiOrb />
        <AiBadge />
      </div>
      <ul className="ai-skeleton" aria-hidden="true">
        <li style={{ width: "62%" }} />
        <li style={{ width: "74%" }} />
        <li style={{ width: "55%" }} />
        <li style={{ width: "68%" }} />
      </ul>
      <p className="ai-scope">
        Runs only when you ask. Reads this task’s title, description, category,
        and estimate — nothing else — and suggests steps you can edit or undo.
      </p>
    </div>
  );
}
/** Types `text` character by character after `delay` ms; instant under reduced motion. */
function TypedText({
  text,
  delay,
  onDone,
}: {
  text: string;
  delay: number;
  onDone?: () => void;
}) {
  const [n, setN] = useState(() => (reducedMotion() ? text.length : 0));
  useEffect(() => {
    if (reducedMotion()) {
      onDone?.();
      return;
    }
    let count = 0;
    let ticker: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      ticker = setInterval(() => {
        count += 1;
        setN(count);
        if (count >= text.length) {
          clearInterval(ticker);
          onDone?.();
        }
      }, 14);
    }, delay);
    return () => {
      clearTimeout(start);
      if (ticker) clearInterval(ticker);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, delay]);
  const typing = n < text.length;
  return (
    <>
      {text.slice(0, n)}
      {typing && <span className="ai-caret" aria-hidden="true" />}
    </>
  );
}
function RevealedStep({
  step,
  index,
  busy,
  disabled,
  onToggle,
}: {
  step: { id: string; title: string; minutes: number; completed: boolean };
  index: number;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const [typed, setTyped] = useState(reducedMotion);
  return (
    <label
      className={`reveal ${typed ? "typed" : ""} ${step.completed ? "done" : ""}`}
      style={{ "--i": index } as CSSProperties}
    >
      <input
        type="checkbox"
        checked={step.completed}
        disabled={busy || disabled}
        onChange={onToggle}
      />
      <span>
        <TypedText
          text={step.title}
          delay={index * 520}
          onDone={() => setTyped(true)}
        />
      </span>
      <small>{minutesLabel(step.minutes)}</small>
    </label>
  );
}
function TaskRow({
  task,
  state,
  busy,
  ai,
  onBreakdown,
}: {
  task: Task;
  state: AppState;
  busy: boolean;
  ai: AiState;
  onBreakdown: Breakdown;
}) {
  const subs = state.subtasks.filter((s) => s.task_id === task.id),
    done = subs.filter((s) => s.completed).length,
    needsSteps = !subs.length && active(task),
    working = ai?.taskId === task.id && ai.phase === "working";
  return (
    <div className={`task-row prio-${task.priority.toLowerCase()}`}>
      <div className="task-main">
        <Link className="task-link" to={`/employee/tasks/${task.id}`}>
          <strong>{task.title}</strong>
        </Link>
        <span>
          <DueChip iso={task.deadline} demoDate={state.workspace.demo_date} />
          <span className="bullet" aria-hidden="true">
            ·
          </span>{" "}
          {task.category}
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
          {duration(task.personalized_hours)} <span>personalized</span>
        </strong>
        <small>{duration(task.estimated_hours)} original estimate</small>
      </div>
      <div className="task-progress">
        {needsSteps ? (
          <button
            className={`btn secondary breakdown-btn ${working ? "is-working" : ""}`}
            disabled={busy}
            onClick={() => onBreakdown(task)}
          >
            {working ? <AiLabel /> : "AI breakdown"}
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
  ai,
  onBreakdown,
}: {
  state: AppState;
  busy: boolean;
  ai: AiState;
  onBreakdown: Breakdown;
}) {
  const navigate = useNavigate();
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
    )
    .sort(byUrgency);
  return (
    <>
      <PageHeading
        title="My tasks"
        subtitle="Assigned work with personalized time estimates."
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
              ai={ai}
              onBreakdown={(task) => {
                navigate(`/employee/tasks/${task.id}`);
                return onBreakdown(task);
              }}
            />
          ))
        ) : (
          <div className="empty">
            <h2>No tasks match this filter</h2>
            <p>Select another filter to view more tasks.</p>
          </div>
        )}
      </div>
    </>
  );
}
function TaskDetail({
  state,
  busy,
  ai,
  run,
  onBreakdown,
}: {
  state: AppState;
  busy: boolean;
  ai: AiState;
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
    disabled = !active(task),
    working = ai !== null && ai.taskId === id && ai.phase === "working",
    reveal = ai !== null && ai.taskId === id && ai.phase === "done";
  return (
    <>
      <Link className="back-link" to="/employee/tasks">
        <ArrowLeft size={16} />
        Back to tasks
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
          <dd>
            <DueChip iso={task.deadline} demoDate={state.workspace.demo_date} />
            <small> · {due(task.deadline)}</small>
          </dd>
        </div>
        <div>
          <dt>Assigned by</dt>
          <dd>Sarah Lee</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{sentence(task.status)}</dd>
        </div>
        <div>
          <dt>Estimate</dt>
          <dd>
            {duration(task.personalized_hours)}
            <small>
              {" "}
              · {duration(task.estimated_hours)} × {task.multiplier.toFixed(2)}
            </small>
          </dd>
        </div>
      </dl>
      <section className="section">
        <div className="section-head">
          <h2>Steps</h2>
          {subs.length ? (
            <span className="muted">
              {subs.filter((s) => s.completed).length} / {subs.length} complete
            </span>
          ) : (
            !disabled && (
              <button
                className={`btn secondary ${working ? "is-working" : ""}`}
                disabled={busy}
                onClick={() => onBreakdown(task)}
              >
                {working ? <AiLabel /> : "AI breakdown"}
              </button>
            )
          )}
        </div>
        <div className="subtask-list">
          {working ? (
            <AiWorking />
          ) : reveal ? (
            subs.map((s, i) => (
              <RevealedStep
                key={s.id}
                step={s}
                index={i}
                busy={busy}
                disabled={disabled}
                onToggle={() => run("subtask", { id: s.id })}
              />
            ))
          ) : subs.length ? (
            subs.map((s) => (
              <label key={s.id} className={s.completed ? "done" : ""}>
                <input
                  type="checkbox"
                  checked={s.completed}
                  disabled={busy || disabled}
                  onChange={() =>
                    run(
                      "subtask",
                      { id: s.id },
                      stepDoneMessage(subs, s.id),
                      () =>
                        run(
                          "subtask",
                          { id: s.id },
                          s.completed
                            ? "Step completed again."
                            : "Step reopened.",
                        ),
                    )
                  }
                />
                <span>{s.title}</span>
                {!s.completed && !disabled && (
                  <Link
                    className="btn secondary start-btn"
                    to={`/employee/focus/${s.id}`}
                  >
                    Start
                  </Link>
                )}
                <small>{minutesLabel(s.minutes)}</small>
              </label>
            ))
          ) : (
            <p className="muted">
              No steps defined. Use AI breakdown to generate steps, or log time
              below.
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
        <h2>Time logged</h2>
        <p className="muted">
          Logged time refines estimates for future tasks. The current estimate
          is fixed while the task is active.
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
            onClick={() => {
              const previous = task.actual_hours;
              void run(
                "hours",
                { id, actual_hours: Number(actual) },
                `${actual} hours logged.`,
                () =>
                  run(
                    "hours",
                    { id, actual_hours: previous },
                    `Hours restored to ${previous}.`,
                  ),
              );
            }}
          >
            Log hours
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
        <ConfirmDialog
          title="Complete this task?"
          confirmLabel="Complete task"
          busy={busy}
          onConfirm={() =>
            run("complete", { id, actual_hours: Number(actual) })
          }
          onClose={() => setCompleteOpen(false)}
        >
          This logs {actual} hours, marks all remaining steps complete, and
          updates the estimates used for future tasks. This cannot be undone.
        </ConfirmDialog>
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
  const total = workload(state.tasks, employee, next, state.subtasks);
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
            <b>{duration(t.personalized_hours)}</b>
          </div>
        ))
      ) : (
        <p className="muted">No active tasks due in this week.</p>
      )}
      <div className="breakdown-total">
        <span>Total active workload</span>
        <strong>{duration(total)}</strong>
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
    workload(state.tasks, "alex", false, state.subtasks) > 30 &&
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
        subtitle="Weekly planning capacity and personalized estimates."
      />
      <CapacityCard state={state} />
      <section className="section">
        <div className="section-head">
          <h2>Workload breakdown</h2>
          <Segmented
            label="Week"
            options={["This week", "Next week"] as const}
            value={next ? "Next week" : "This week"}
            onChange={(v) => setNext(v === "Next week")}
          />
        </div>
        <Breakdown state={state} next={next} />
        <p className="caption">
          Includes active tasks due {next ? "next" : "this"} week and overdue
          carryover, counting the remaining effort on each: completed steps and
          logged hours reduce it.
        </p>
      </section>
      <section className="section optional">
        <h2>Focus capacity</h2>
        <p className="muted">
          Of a 40-hour week, 10 hours are reserved for meetings, administration,
          communication, and breaks. This is a configured planning value for the
          demo.
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
      <section className="section optional">
        <div className="section-head">
          <h2>Estimate calibration</h2>
          <span className="muted">Based on completed work</span>
        </div>
        <div className="table-wrap">
          <table className="learning-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Original average</th>
                <th>Recent average</th>
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
                    <td>{duration(avg("estimated_hours"))}</td>
                    <td>{duration(avg("actual_hours"))}</td>
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
          Each factor is the median of actual-to-estimated time across up to 10
          recent tasks, kept between 0.5 and 3.0. Categories with fewer than 3
          samples use the overall factor. Changes apply to future estimates.
        </p>
      </section>
    </>
  );
}
function ManagerDashboard({
  state,
  userName,
}: {
  state: AppState;
  userName: string;
}) {
  const now = useNow();
  const employees = state.profiles
    .filter((p) => p.id !== "sarah")
    .sort(
      (a, b) =>
        workload(state.tasks, b.id, false, state.subtasks) / b.capacity -
        workload(state.tasks, a.id, false, state.subtasks) / a.capacity,
    );
  const states = employees.map(
    (p) =>
      status(workload(state.tasks, p.id, false, state.subtasks), p.capacity)
        .label,
  );
  const openRequests = state.negotiations.filter((n) =>
    ["pending", "counter_proposed"].includes(n.status),
  ).length;
  return (
    <>
      <PageHeading
        eyebrow={`${longDate.format(now)} · ${clock.format(now)}`}
        title={`${greeting(now)}, ${userName}.`}
        subtitle="Team capacity and open workload requests for this week."
      />
      <dl className="stats-row">
        <div>
          <dd>{employees.length}</dd>
          <dt>Team members</dt>
        </div>
        <div>
          <dd>{states.filter((s) => s === "Over capacity").length}</dd>
          <dt>Capacity conflicts</dt>
        </div>
        <div>
          <dd>{states.filter((s) => s === "Near capacity").length}</dd>
          <dt>Near capacity</dt>
        </div>
        <div>
          <dd>{openRequests}</dd>
          <dt>Open requests</dt>
        </div>
      </dl>
      <section className="section">
        <div className="section-head">
          <h2>Team capacity</h2>
          <span className="muted">Sorted by utilization</span>
        </div>
        <div className="team-list">
          {employees.map((p) => {
            const load = workload(state.tasks, p.id, false, state.subtasks),
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
                    <span className="bullet" aria-hidden="true">
                      ·
                    </span>
                    {risks ? `${risks} tasks at risk` : "No tasks at risk"}
                    {requests > 0 && (
                      <>
                        <span className="bullet" aria-hidden="true">
                          ·
                        </span>
                        {requests} request pending
                      </>
                    )}
                  </span>
                </div>
                <div className="team-meter">
                  <Progress load={load} capacity={p.capacity} />
                </div>
                <strong className="team-hours">
                  {duration(load)}
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
          <Link
            className="text-link"
            to="/manager/negotiations"
            aria-label="View all workload requests"
          >
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
          <p className="muted">No workload requests.</p>
        )}
      </section>
      <p className="privacy-note">
        This view includes assigned work, capacity, and shared requests only.
        Personal notes and health information are not included.
      </p>
    </>
  );
}
function EmployeeDetail({ state }: { state: AppState }) {
  const { id } = useParams(),
    p = state.profiles.find((p) => p.id === id && p.id !== "sarah");
  if (!p) return <NotFound />;
  const load = workload(state.tasks, p.id, false, state.subtasks);
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
          <dd>{duration(load)}</dd>
          <dt>Current workload</dt>
        </div>
        <div>
          <dd>{p.capacity}h</dd>
          <dt>Weekly focus capacity</dt>
        </div>
        <div>
          <dd>{duration(Math.abs(load - p.capacity))}</dd>
          <dt>{load > p.capacity ? "Above capacity" : "Available"}</dt>
        </div>
      </dl>
      <section className="section">
        <div className="section-head">
          <h2>Assigned work this week</h2>
          <span className="muted">Personalized estimates</span>
        </div>
        <Breakdown state={state} employee={p.id} />
      </section>
      <section className="section">
        <h2>Workload requests</h2>
        {requests.length ? (
          requests.map((n) => (
            <RequestRow key={n.id} n={n} role="manager" state={state} />
          ))
        ) : (
          <p className="muted">No workload requests for this team member.</p>
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
        {sentence(n.status)}
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
        subtitle="Review and agree workload adjustments with your superior."
      >
        {role === "employee" &&
          workload(state.tasks, "alex", false, state.subtasks) > 30 &&
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
            <h2>No workload requests</h2>
            <p>
              No {filter === "All" ? "" : filter.toLowerCase() + " "}requests.
              When workload exceeds capacity, use Resolve workload to submit
              one.
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
    before = workload(state.tasks, "alex", false, state.subtasks),
    load = workload(after, "alex", false, state.subtasks),
    other =
      proposal.type === "reassign" ? person(state, proposal.employee_id) : null;
  return (
    <div className="proposal-impact">
      <div className="impact-numbers">
        <div>
          <span>Current week</span>
          <strong>
            {duration(before)}
            <small> / 30h</small>
          </strong>
        </div>
        <ArrowRight size={24} />
        <div>
          <span>After adjustment</span>
          <strong>
            {duration(load)}
            <small> / 30h</small>
          </strong>
        </div>
      </div>
      <Progress load={load} capacity={30} />
      <div className="impact-result">
        <span>{duration(before - load)} removed from this week</span>
        <Badge load={load} capacity={30} />
      </div>
      {proposal.type === "deadline" && (
        <p>
          {due(task.deadline, true)} → {due(proposal.deadline!, true)}. Next
          week: {duration(workload(after, "alex", true, state.subtasks))} / 30h.
        </p>
      )}
      {proposal.type === "scope" && (
        <p>
          Removes the detailed competitor analysis section.{" "}
          {load > 30
            ? `${duration(load - 30)} would remain over capacity.`
            : "Remaining workload is within capacity."}
        </p>
      )}
      {other && (
        <p>
          {other.name}:{" "}
          {duration(workload(after, other.id, false, state.subtasks))} /{" "}
          {other.capacity}h after reassignment.
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
          ? `Thank you for flagging this. I propose we ${proposal.label.charAt(0).toLowerCase() + proposal.label.slice(1)} instead so the plan remains realistic.`
          : `Based on my current workload, I would like to ${proposal.label.charAt(0).toLowerCase() + proposal.label.slice(1)}. This would bring my active workload to ${duration(workload(applyPreview(state, proposal), "alex", false, state.subtasks))} / 30h. Please let me know if this adjustment works.`,
      );
  }, [selected, mode]);
  return (
    <Modal
      title={
        mode === "counter"
          ? "Propose an alternative adjustment"
          : mode === "revise"
            ? "Propose a revised adjustment"
            : "Request a workload adjustment"
      }
      onClose={onClose}
    >
      <p className="muted">
        Select an adjustment to propose. This goes directly to Sarah Lee as a
        message you write — no AI in between. Tasks change only after both of
        you agree.
      </p>
      <div
        className="proposal-options"
        role="radiogroup"
        aria-label="Workload adjustments"
        onKeyDown={(e) => {
          const step =
            e.key === "ArrowDown" || e.key === "ArrowRight"
              ? 1
              : e.key === "ArrowUp" || e.key === "ArrowLeft"
                ? -1
                : 0;
          if (!step) return;
          e.preventDefault();
          const next = (selected + step + options.length) % options.length;
          setSelected(next);
          (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
        }}
      >
        {options.map((o, i) => (
          <button
            role="radio"
            aria-checked={selected === i}
            tabIndex={selected === i ? 0 : -1}
            className={selected === i ? "selected" : ""}
            key={o.label}
            onClick={() => setSelected(i)}
          >
            <span className="radio-mark">{selected === i && <span />}</span>
            <span>
              <ProposalTitle state={state} proposal={o} />
              <small>
                {duration(
                  workload(state.tasks, "alex", false, state.subtasks) -
                    workload(
                      applyPreview(state, o),
                      "alex",
                      false,
                      state.subtasks,
                    ),
                )}{" "}
                less this week
                {workload(
                  applyPreview(state, o),
                  "alex",
                  false,
                  state.subtasks,
                ) > 30
                  ? " · partial relief"
                  : " · within capacity"}
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
            Message
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
              {mode === "counter" ? "Send counter-proposal" : "Send request"}
            </button>
          </div>
        </>
      ) : (
        <p className="muted">
          No adjustment options are available for the remaining tasks.
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
  const [confirm, setConfirm] = useState<"decline" | "cancel" | null>(null);
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
        subtitle={`Revision ${n.revision} · ${sentence(n.status)}`}
      />
      <section className="section">
        <h2>Proposed adjustment</h2>
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
              Current workload:{" "}
              {duration(workload(state.tasks, "alex", false, state.subtasks))} /
              30h
            </strong>
          </div>
        )}
        {open && stale && (
          <div className="warning-box">
            This task changed after the proposal was sent.{" "}
            {role === "manager"
              ? "Submit a new counter-proposal."
              : "Cancel this request and submit a new adjustment, or revise the counter-proposal."}
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
                onClick={() => setConfirm("decline")}
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
                Revise proposal
              </button>
            </>
          )}
          {role === "employee" && open && (
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => setConfirm("cancel")}
            >
              Cancel request
            </button>
          )}
          {role === "employee" && n.status === "pending" && (
            <p className="muted">
              Awaiting response from Sarah Lee. Assignments remain unchanged
              until approval.
            </p>
          )}
        </div>
      </section>
      <section className="section">
        <h2>Discussion</h2>
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
      {confirm === "decline" && (
        <ConfirmDialog
          title="Decline this request?"
          confirmLabel="Decline request"
          danger
          busy={busy}
          onConfirm={() => run("decline", { id }, "Request declined.")}
          onClose={() => setConfirm(null)}
        >
          Alex Morgan will be notified and current assignments stay unchanged.
          To suggest a different adjustment instead, use Counter-propose.
        </ConfirmDialog>
      )}
      {confirm === "cancel" && (
        <ConfirmDialog
          title="Cancel this request?"
          confirmLabel="Cancel request"
          danger
          busy={busy}
          onConfirm={() => run("cancel", { id }, "Request cancelled.")}
          onClose={() => setConfirm(null)}
        >
          The request is withdrawn and Sarah Lee can no longer respond to it.
          You can submit a new request at any time.
        </ConfirmDialog>
      )}
    </>
  );
}
function NotFound() {
  return (
    <div className="empty">
      <h1>Item not found</h1>
      <Link className="btn primary" to="/employee/dashboard">
        Back to overview
      </Link>
    </div>
  );
}
