import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeCommand } from '../../../plugin/plugin.js';

// Spec: openspec/changes/add-task-backlog-tools/specs/task-backlog/spec.md
// executeCommand reads the global PluginAPI SP injects at runtime; tests stub it directly.

interface Proj {
  id: string;
  taskIds: string[];
  backlogTaskIds: string[];
  isEnableBacklog: boolean;
}
interface Tsk {
  id: string;
  projectId: string | null;
  parentId?: string | null;
}

let projects: Proj[];
let tasks: Tsk[];
let api: {
  getTasks: ReturnType<typeof vi.fn>;
  getAllProjects: ReturnType<typeof vi.fn>;
  updateProject: ReturnType<typeof vi.fn>;
  reorderTasks: ReturnType<typeof vi.fn>;
};

const proj = (id: string, taskIds: string[], backlogTaskIds: string[], isEnableBacklog = true): Proj => ({
  id,
  taskIds,
  backlogTaskIds,
  isEnableBacklog,
});

beforeEach(() => {
  projects = [proj('p1', ['a', 'b'], ['c', 'd']), proj('p2', ['e'], ['f']), proj('inbox', ['g'], ['h'], false)];
  tasks = [
    ...['a', 'b', 'c', 'd'].map((id) => ({ id, projectId: 'p1' })),
    ...['e', 'f'].map((id) => ({ id, projectId: 'p2' })),
    ...['g', 'h'].map((id) => ({ id, projectId: 'inbox' })),
    { id: 'sub', projectId: 'p1', parentId: 'a' },
    { id: 'orphan', projectId: null },
    { id: 'lost', projectId: 'gone' },
    { id: 'stray', projectId: 'p1' },
  ];
  api = {
    getTasks: vi.fn(async () => tasks),
    getAllProjects: vi.fn(async () => projects),
    updateProject: vi.fn().mockResolvedValue(undefined),
    reorderTasks: vi.fn().mockResolvedValue(undefined),
  };
  Object.assign(globalThis, { PluginAPI: api });
});

const move = (taskIds: string[], destination: 'backlog' | 'regular') =>
  executeCommand({ action: 'moveTasksBacklog', taskIds, destination });

const written = (projectId: string) =>
  api.updateProject.mock.calls.find(([id]) => id === projectId)?.[1] as
    | { taskIds: string[]; backlogTaskIds: string[] }
    | undefined;

describe('moveTasksBacklog: moving', () => {
  it('moves a regular-list task into the backlog', async () => {
    const res = await move(['a'], 'backlog');
    expect(res.success).toBe(true);
    expect(written('p1')).toEqual({ taskIds: ['b'], backlogTaskIds: ['c', 'd', 'a'] });
  });

  it('moves a backlog task to the regular list', async () => {
    const res = await move(['c'], 'regular');
    expect(res.success).toBe(true);
    expect(written('p1')).toEqual({ taskIds: ['a', 'b', 'c'], backlogTaskIds: ['d'] });
  });

  it('appends moved tasks in task_ids order', async () => {
    await move(['b', 'a'], 'backlog');
    expect(written('p1')).toEqual({ taskIds: [], backlogTaskIds: ['c', 'd', 'b', 'a'] });
  });

  it('moves tasks from several projects with one write per project', async () => {
    const res = await move(['a', 'e'], 'backlog');
    expect(res.success).toBe(true);
    expect(api.updateProject).toHaveBeenCalledTimes(2);
    expect(written('p1')).toEqual({ taskIds: ['b'], backlogTaskIds: ['c', 'd', 'a'] });
    expect(written('p2')).toEqual({ taskIds: [], backlogTaskIds: ['f', 'e'] });
  });

  it('leaves each task in exactly one list', async () => {
    await move(['a', 'c'], 'backlog');
    const w = written('p1')!;
    for (const id of ['a', 'c']) {
      expect(w.taskIds.includes(id) !== w.backlogTaskIds.includes(id)).toBe(true);
    }
  });
});

describe('moveTasksBacklog: task in both lists', () => {
  beforeEach(() => {
    projects = [proj('p1', ['a', 'b'], ['b', 'c'])];
  });

  it('repairs a task that is in both lists when moving to the backlog', async () => {
    const res = await move(['b'], 'backlog');
    expect(res.result).toEqual({ moved: ['b'], unchanged: [] });
    expect(written('p1')).toEqual({ taskIds: ['a'], backlogTaskIds: ['c', 'b'] });
  });

  it('repairs a task that is in both lists when moving to the regular list', async () => {
    const res = await move(['b'], 'regular');
    expect(res.result).toEqual({ moved: ['b'], unchanged: [] });
    expect(written('p1')).toEqual({ taskIds: ['a', 'b'], backlogTaskIds: ['c'] });
  });
});

describe('moveTasksBacklog: result', () => {
  it('reports moved and unchanged IDs', async () => {
    const res = await move(['a', 'c'], 'backlog');
    expect(res.result).toEqual({ moved: ['a'], unchanged: ['c'] });
  });

  it('treats a task already at the destination as unchanged, without duplicating it or writing', async () => {
    const res = await move(['c'], 'backlog');
    expect(res.success).toBe(true);
    expect(res.result).toEqual({ moved: [], unchanged: ['c'] });
    expect(api.updateProject).not.toHaveBeenCalled();
  });

  it('processes a duplicate ID once', async () => {
    const res = await move(['a', 'a'], 'backlog');
    expect(res.result).toEqual({ moved: ['a'], unchanged: [] });
    expect(written('p1')).toEqual({ taskIds: ['b'], backlogTaskIds: ['c', 'd', 'a'] });
  });
});

describe('moveTasksBacklog: validation is all-or-nothing before writing', () => {
  it.each([
    ['an unknown task', 'nope', 'Task not found'],
    ['a subtask', 'sub', 'subtask'],
    ['a task without a project', 'orphan', 'no project'],
    ['a task whose project does not exist', 'lost', 'Project not found'],
    ['a task in neither list', 'stray', 'stray'],
  ])('rejects %s, names it, and writes nothing', async (_label, id, msg) => {
    const res = await move(['a', id], 'backlog');
    expect(res.success).toBe(false);
    expect(res.error).toContain(id === 'lost' ? 'lost' : id);
    expect(res.error).toContain(msg);
    expect(api.updateProject).not.toHaveBeenCalled();
  });

  it('reports the failed project and the projects already written when a write fails mid-batch', async () => {
    api.updateProject.mockImplementation(async (id: string) => {
      if (id === 'p2') throw new Error('boom');
    });
    const res = await move(['a', 'e'], 'backlog');
    expect(res.success).toBe(false);
    expect(res.error).toContain('p2');
    expect(res.error).toContain('p1');
    expect(res.error).toContain('boom');
  });
});

describe('moveTasksBacklog: disabled backlog', () => {
  it('refuses a move into the backlog of a backlog-disabled project, naming the project', async () => {
    const res = await move(['g'], 'backlog');
    expect(res.success).toBe(false);
    expect(res.error).toContain('inbox');
    expect(api.updateProject).not.toHaveBeenCalled();
  });

  it('refuses the whole batch when one task targets a disabled backlog', async () => {
    const res = await move(['a', 'g'], 'backlog');
    expect(res.success).toBe(false);
    expect(api.updateProject).not.toHaveBeenCalled();
  });

  it('allows recovering a task stranded in a disabled backlog to the regular list', async () => {
    const res = await move(['h'], 'regular');
    expect(res.success).toBe(true);
    expect(written('inbox')).toEqual({ taskIds: ['g', 'h'], backlogTaskIds: [] });
  });
});

describe('reorderTasks: backlog guard', () => {
  const reorder = (taskIds: string[], contextType = 'project', contextId = 'p1') =>
    executeCommand({ action: 'reorderTasks', taskIds, contextId, contextType });

  it('rejects a task ID that is in the project backlog, naming it and pointing to move_tasks_backlog', async () => {
    const res = await reorder(['b', 'a', 'c']);
    expect(res.success).toBe(false);
    expect(res.error).toContain('c');
    expect(res.error).toContain('move_tasks_backlog');
    expect(api.reorderTasks).not.toHaveBeenCalled();
  });

  it('still reorders regular-list tasks', async () => {
    const res = await reorder(['b', 'a']);
    expect(res.success).toBe(true);
    expect(api.reorderTasks).toHaveBeenCalledWith(['b', 'a'], 'p1', 'project');
  });
});
