# Data Model: Super Productivity MCP Server

## IPC Command

A JSON file written by the MCP server to `plugin_commands/`.

```typescript
interface Command {
  id: string;              // Unique ID: `${action}_${timestamp}`
  action: string;          // e.g., "addTask", "getTasks", "ping"
  protocolVersion: number; // Starting at 1
  timestamp: number;       // Date.now()
  // Action-specific fields:
  data?: Record<string, unknown>;  // For create/update operations
  taskId?: string;                 // For task-specific operations
  projectId?: string;              // For project-specific operations
  tagId?: string;                  // For tag-specific operations
  message?: string;                // For showSnack
  filters?: TaskFilters;           // For getTasks
}

interface TaskFilters {
  projectId?: string;
  tagId?: string;
  includeDone?: boolean;     // Default: false
  includeArchived?: boolean; // Default: false — when true, also fetches archived tasks
  searchQuery?: string;      // Case-insensitive title match
}
```

**File naming**: `{command.id}.json`
**Lifecycle**: Created by server → Read by plugin → Deleted by plugin after response written

## IPC Response

A JSON file written by the SP plugin to `plugin_responses/`.

```typescript
interface Response {
  success: boolean;
  result?: unknown;        // Action-specific result data
  error?: string;          // Human-readable error message
  timestamp: number;       // Date.now()
  executionTime?: number;  // Milliseconds
}
```

**File naming**: `{command.id}_response.json`
**Lifecycle**: Created by plugin → Read by server → Deleted by server

## MCP Config Bridge

Written by the MCP server when `SP_MCP_DATA_DIR` is set. Read by the plugin on startup.

```typescript
interface McpConfig {
  dataDir: string;  // Absolute path to the data directory
}
```

**File location**: Standard platform directory / `mcp_config.json`

## SP Entities (read-only reference from Plugin API)

These are the SP data types returned by `PluginAPI`. The MCP server receives them as JSON via IPC responses.

### Task

```typescript
interface Task {
  id: string;
  title: string;
  notes?: string;
  timeEstimate: number;       // Milliseconds
  timeSpent: number;          // Milliseconds
  isDone: boolean;
  doneOn?: number | null;     // Timestamp when completed
  projectId: string | null;
  tagIds: string[];
  parentId?: string | null;
  subTaskIds: string[];
  timeSpentOnDay?: {          // Map of ISO date string → milliseconds
    [date: string]: number;   // e.g., { "2026-04-20": 3600000 }
  };
  created: number;
  updated?: number;
}
```

### Project

```typescript
interface Project {
  id: string;
  title: string;
  theme: { primary?: string };
  isArchived?: boolean;
  taskIds: string[];
  backlogTaskIds: string[];
}
```

### Tag

```typescript
interface Tag {
  id: string;
  title: string;
  color?: string | null;
  icon?: string | null;
  taskIds: string[];
}
```

## State Transitions

### Task Lifecycle

```
Created (isDone: false, doneOn: null)
  → Updated (title, notes, timeEstimate, timeSpent changes)
  → Completed (isDone: true, doneOn: timestamp)
  → Reopened (isDone: false, doneOn: null)
```

### Command Lifecycle

```
Written (server writes JSON to plugin_commands/)
  → Processing (plugin reads, executes PluginAPI call)
  → Responded (plugin writes response to plugin_responses/, deletes command)
  → Consumed (server reads response, deletes response file)
  
  Timeout path:
  Written → 30s elapsed → Timeout (server deletes orphaned command, returns error)
  
  Stale cleanup:
  Any file older than 5 minutes → Deleted on startup
```
