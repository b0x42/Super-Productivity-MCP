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
}

export interface TaskFilters {
  projectId?: string;
  tagId?: string;
  includeDone?: boolean;
  includeArchived?: boolean;
  searchQuery?: string;
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
