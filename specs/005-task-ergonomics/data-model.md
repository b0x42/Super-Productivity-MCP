# Data Model: Task Ergonomics

**Feature**: Task Ergonomics
**Created**: 2026-04-29
**Source**: [spec.md](spec.md)

## Feature 1: Field Selection

### Implementation

Field selection is applied **server-side** after all filtering. No plugin changes needed.

```typescript
// In get_tasks handler, after filtering:
if (fields && fields.length > 0) {
  tasks = tasks.map(t => {
    const shaped: Record<string, unknown> = {};
    for (const f of fields) {
      if (f in t) shaped[f] = t[f];
    }
    return shaped;
  });
}
```

### Input Schema Addition

```typescript
fields: z.array(z.string()).optional().describe(
  'Return only these fields per task (e.g. ["id", "title", "dueDay"]). Omit for full objects.'
)
```

### Valid Fields

All fields from the `TaskRecord` interface that are useful to AI clients:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Task ID |
| `title` | `string` | Task title |
| `isDone` | `boolean` | Completion state |
| `projectId` | `string \| null` | Project assignment |
| `parentId` | `string \| null` | Parent task (null = top-level) |
| `tagIds` | `string[]` | Tag assignments |
| `dueDay` | `string \| null` | Due date (YYYY-MM-DD) |
| `dueWithTime` | `number \| null` | Scheduled time (Unix ms) |
| `plannedAt` | `number \| null` | Planned-for-today timestamp |
| `timeEstimate` | `number` | Estimate in ms |
| `timeSpent` | `number` | Spent in ms |
| `notes` | `string` | Task notes |
| `subTaskIds` | `string[]` | Child task IDs |
| `doneOn` | `number \| null` | Completion timestamp |

---

## Feature 2: Delete Task

### New IPC Action: `deleteTask`

**Request**:
```json
{
  "action": "deleteTask",
  "taskId": "<task-id>"
}
```

**Plugin handler**: Uses `PluginAPI.deleteTask(taskId)` (available in plugin-api). Falls back to `dispatchAction({ type: '[Task] Delete Task', payload: { task } })` if needed.

**Success response**:
```json
{ "success": true, "result": null }
```

**Error cases**:
- Task not found → `{ "success": false, "error": "Task not found: <taskId>" }`

### MCP Tool

```typescript
server.registerTool('delete_task', {
  description: 'Permanently delete a task. Deleting a parent also removes all subtasks.',
  inputSchema: {
    task_id: z.string().describe('Task ID to delete'),
  },
}, async ({ task_id }) => { ... });
```

---

## Feature 3: Create Task with Subtasks

### New IPC Action: `createTaskWithSubtasks`

**Request**:
```json
{
  "action": "createTaskWithSubtasks",
  "data": {
    "title": "Plan launch",
    "notes": "",
    "projectId": "proj-1",
    "tagIds": ["tag-a"],
    "subtasks": [
      { "title": "Write copy" },
      { "title": "Design assets", "notes": "Use brand kit" },
      { "title": "Schedule posts" }
    ]
  }
}
```

**Plugin handler**:
1. Call `addTask({ title, notes, projectId, tagIds })` → get `parentId`
2. For each subtask: call `addTask({ title, notes, parentId })` → collect IDs
3. Return `{ parentId, subtaskIds: [...] }`

**Success response**:
```json
{
  "success": true,
  "result": {
    "parentId": "task-abc",
    "subtaskIds": ["task-def", "task-ghi", "task-jkl"]
  }
}
```

**Error cases**:
- Empty title → `{ "success": false, "error": "Title is required" }`
- Parent creation fails → top-level error, no subtasks created

### MCP Tool

```typescript
server.registerTool('create_task_with_subtasks', {
  description: 'Create a parent task with subtasks in one operation.',
  inputSchema: {
    title: z.string().describe('Parent task title'),
    notes: z.string().optional().describe('Parent task notes'),
    project_id: z.string().optional().describe('Project ID'),
    tag_ids: z.array(z.string()).optional().describe('Tag IDs for parent'),
    subtasks: z.array(z.object({
      title: z.string().describe('Subtask title'),
      notes: z.string().optional().describe('Subtask notes'),
    })).describe('Subtask definitions'),
  },
}, async ({ title, notes, project_id, tag_ids, subtasks }) => { ... });
```

## Plugin Changes Required

| Feature | Plugin Change |
|---------|--------------|
| Field selection | None — server-side only |
| Delete task | New `deleteTask` handler |
| Create with subtasks | New `createTaskWithSubtasks` handler |

## Command Extensions

New fields on `Command` interface in `src/ipc/types.ts`:

```typescript
// Already exists: data, taskId
// No new fields needed — deleteTask uses taskId, createTaskWithSubtasks uses data
```
