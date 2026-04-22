export interface Command {
  id: string;
  action: string;
  protocolVersion: number;
  timestamp: number;
  data?: Record<string, unknown>;
  taskId?: string;
  projectId?: string;
  tagId?: string;
  message?: string;
  filters?: TaskFilters;
  // Fields for reorderTasks (FR-009)
  taskIds?: string[];
  contextId?: string;
  contextType?: 'project' | 'parent';
}

export interface TaskFilters {
  projectId?: string;
  tagId?: string;
  includeDone?: boolean;
  includeArchived?: boolean;
  searchQuery?: string;
  // Triage filters (FR-004, FR-005, FR-006) — applied server-side after getTasks()
  parentsOnly?: boolean;
  overdue?: boolean;
  unscheduled?: boolean;
}

export interface Response {
  success: boolean;
  result?: unknown;
  error?: string;
  timestamp: number;
  executionTime?: number;
}

export interface McpConfig {
  dataDir: string;
}

export const PROTOCOL_VERSION = 1;
