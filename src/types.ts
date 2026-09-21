export type Role = "employee" | "manager";
export interface Profile {
  id: string;
  name: string;
  job_title: string;
  manager_id: string | null;
  capacity: number;
  weekly_hours: number;
}
export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  completed: boolean;
  minutes: number;
  position: number;
}
export interface Task {
  id: string;
  employee_id: string;
  title: string;
  description: string;
  category: string;
  priority: "High" | "Medium" | "Low";
  status: "draft" | "todo" | "in_progress" | "completed" | "cancelled";
  deadline: string;
  estimated_hours: number;
  personalized_hours: number;
  actual_hours: number;
  multiplier: number;
  flexible: boolean;
  scope_saving: number;
  version: number;
  assigned_by: string;
}
export interface History {
  id: string;
  employee_id: string;
  task_id: string | null;
  category: string;
  estimated_hours: number;
  actual_hours: number;
  completed_at: string;
}
export interface Proposal {
  type: "deadline" | "scope" | "reassign";
  task_id: string;
  task_version: number;
  deadline?: string;
  scope_hours?: number;
  employee_id?: string;
  label: string;
}
export interface Negotiation {
  id: string;
  employee_id: string;
  manager_id: string;
  trigger_task_id: string;
  status:
    "pending" | "counter_proposed" | "approved" | "declined" | "cancelled";
  revision: number;
  proposal: Proposal;
  workload_snapshot: number;
  created_at: string;
  updated_at: string;
}
export interface Message {
  id: string;
  negotiation_id: string;
  author: Role;
  body: string;
  revision: number;
  created_at: string;
}
export interface AppState {
  workspace: { id: string; version: number; demo_date: string };
  profiles: Profile[];
  tasks: Task[];
  subtasks: Subtask[];
  history: History[];
  negotiations: Negotiation[];
  messages: Message[];
  dependencies: { task_id: string; prerequisite_id: string }[];
}
