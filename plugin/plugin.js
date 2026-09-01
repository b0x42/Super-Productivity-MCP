// MCP Bridge Plugin for Super Productivity
const PROTOCOL_VERSION = 1;
// Kept in step with plugin/manifest.json by tests/unit/plugin/version.test.ts —
// this was a literal in the ping handler and check_connection reported 1.6.0
// from a 1.7.0 plugin for a whole release.
const PLUGIN_VERSION = '1.7.0';
const POLL_INTERVAL_MS = 2000;
let commandDir = null;
let responseDir = null;
let pollTimer = null;
let lastProcessed = 0;
let currentTrackedTask = null;

function unwrapNodeResult(result) {
  return result && result.success && result.result && typeof result.result === 'object' ? result.result : result;
}

function assertNodeResult(result, context) {
  const r = unwrapNodeResult(result);
  if (!r || !r.success) {
    throw new Error(context + ': ' + ((r && r.error) || 'Node script failed'));
  }
  return r;
}

// Parse @date short syntax (e.g. "@today 6pm", "@monday", "@3days") out of a task title
// since PluginAPI.addTask doesn't process it. Returns the computed dueDay (or null) and the
// title with the @syntax stripped. The trailing time token (HH, HH:MM, with optional am/pm) is
// only consumed when not immediately followed by a letter/digit, so duration syntax like
// "6h/11h" or "14h" isn't mistaken for a bare hour and partially eaten.
function parseAtDateSyntax(title, now = new Date()) {
  const dateMatch = title.match(/@(\S+)(?:\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)(?![a-zA-Z0-9]))?/i);
  let dueDay = null;
  const localDateStr = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  if (dateMatch) {
    const keyword = dateMatch[1].toLowerCase();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (keyword === 'today' || keyword === '0days') {
      dueDay = localDateStr(today);
    } else if (keyword === 'tomorrow' || keyword === '1days') {
      today.setDate(today.getDate() + 1);
      dueDay = localDateStr(today);
    } else if (/^\d+days?$/.test(keyword)) {
      const days = parseInt(keyword);
      today.setDate(today.getDate() + days);
      dueDay = localDateStr(today);
    } else {
      const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const idx = dayNames.indexOf(keyword);
      if (idx !== -1) {
        const diff = (idx - now.getDay() + 7) % 7 || 7;
        today.setDate(today.getDate() + diff);
        dueDay = localDateStr(today);
      }
    }
  }

  const cleanTitle = dueDay
    ? title.replace(/@\S+(\s+\d{1,2}(:\d{2})?\s*(am|pm)?(?![a-zA-Z0-9]))?/i, ' ').replace(/\s+/g, ' ').trim()
    : title;

  return { dueDay, cleanTitle };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseAtDateSyntax, executeCommand, PLUGIN_VERSION };
}

// Set one or more days in a timeSpentOnDay map and recompute the derived total.
// SP stores timeSpent as the sum of the per-day map, and PluginAPI exposes no
// addTimeSpent action to keep them in sync — writing timeSpentOnDay through the
// generic updateTask means we own that recomputation. A day that lands on zero is
// removed rather than kept, so get_worklog never reports a day with no work on it.
// The total is summed once at the end, not per day.
function applyDayTimes(timeSpentOnDay, changes) {
  const map = Object.assign({}, timeSpentOnDay || {});
  for (const change of changes) {
    if (change.ms > 0) {
      map[change.date] = change.ms;
    } else {
      delete map[change.date];
    }
  }
  return { timeSpentOnDay: map, timeSpent: sumDayMap(map) };
}

function sumDayMap(map) {
  return Object.keys(map || {}).reduce((sum, key) => sum + (map[key] || 0), 0);
}

// Local YYYY-MM-DD for "today", matching how SP's own getDbDateStr keys countOnDay
// (local calendar day, not UTC — avoids shifting a day in positive timezones).
function todayLocalDateStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Habit (SimpleCounter) full-model PluginAPI methods shipped in a later SP release
// than this plugin's declared minSupVersion — probe before use instead of letting
// a "not a function" TypeError leak out of the plugin sandbox.
function missingHabitApiError() {
  const required = ['getAllSimpleCounters', 'getSimpleCounter', 'updateSimpleCounter', 'setSimpleCounterDate', 'deleteSimpleCounter', 'setCounter'];
  const missing = required.filter(fn => typeof PluginAPI[fn] !== 'function');
  return missing.length ? 'Habit management requires a newer version of Super Productivity.' : null;
}

async function setupDirectories() {
  const result = await PluginAPI.executeNodeScript({
    script: `
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const home = os.homedir();
      const APP = 'super-productivity-mcp';
      const TMP_ROOT = '/tmp';
      const TMP_DATA_DIR = path.join(TMP_ROOT, APP);
      let candidates;
      if (os.platform() === 'darwin') {
        candidates = [
          path.join(home, 'Library', 'Containers', 'com.super-productivity.app', 'Data', 'Library', 'Application Support', APP),
          path.join(home, 'Library', 'Application Support', APP)
        ];
      } else if (os.platform() === 'win32') {
        const appData = (typeof process !== 'undefined' && process.env && process.env.APPDATA) || path.join(home, 'AppData', 'Roaming');
        candidates = [path.join(appData, APP)];
      } else {
        const xdgData = (typeof process !== 'undefined' && process.env && process.env.XDG_DATA_HOME) || path.join(home, '.local', 'share');
        candidates = [
          path.join(home, '.var', 'app', 'com.super_productivity.SuperProductivity', 'data', APP),
          path.join(home, '.var', 'app', 'com.super_productivity.SuperProductivity', 'config', APP),
          path.join(xdgData, APP),
          path.join(home, 'snap', 'superproductivity', 'common', '.local', 'share', APP),
          path.join(home, 'snap', 'superproductivity', 'current', '.local', 'share', APP),
          path.join('/tmp', APP) // last-resort: world-writable dir, but mode 0o700 restricts access
        ];
      }
      const errors = [];
      const configCandidates = candidates.filter(function(p) { return p !== TMP_DATA_DIR; });
      function isTmpDataDir(dir) {
        return dir === TMP_ROOT || dir.indexOf(TMP_ROOT + '/') === 0;
      }
      function ensureWritableDir(dir) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const testFile = path.join(dir, '.write-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
        fs.writeFileSync(testFile, 'ok', { mode: 0o600 });
        fs.unlinkSync(testFile);
      }
      function ensureIpcDirs(baseDir) {
        const cd = path.join(baseDir, 'plugin_commands');
        const rd = path.join(baseDir, 'plugin_responses');
        ensureWritableDir(baseDir);
        ensureWritableDir(cd);
        ensureWritableDir(rd);
        return { commandDir: cd, responseDir: rd };
      }
      // Check for mcp_config.json override
      for (const p of configCandidates) {
        try {
          const cfg = path.join(p, 'mcp_config.json');
          if (fs.existsSync(cfg)) {
            const c = JSON.parse(fs.readFileSync(cfg, 'utf-8'));
            if (c.dataDir && fs.existsSync(c.dataDir) && !isTmpDataDir(c.dataDir)) {
              const dirs = ensureIpcDirs(c.dataDir);
              return { success: true, commandDir: dirs.commandDir, responseDir: dirs.responseDir };
            }
          }
        } catch (e) {
          errors.push(p + ' config: ' + (e.message || e));
        }
      }
      // Probe candidates
      for (const p of candidates) {
        try {
          const dirs = ensureIpcDirs(p);
          return { success: true, commandDir: dirs.commandDir, responseDir: dirs.responseDir };
        } catch (e) {
          errors.push(p + ': ' + (e.message || e));
        }
      }
      return { success: false, error: 'No writable directory found. Tried:\\n' + errors.join('\\n') };
    `,
    args: [],
    timeout: 10000,
  });
  // executeNodeScript wraps result: could be result.result.success or result.success
  const r = unwrapNodeResult(result);
  if (r && r.success) {
    commandDir = r.commandDir;
    responseDir = r.responseDir;
  } else {
    throw new Error(r ? r.error : 'Directory setup failed');
  }
}

async function writeResponse(commandId, response) {
  const payload = JSON.stringify(response, null, 2) || 'null';
  const chunkSize = 16 * 1024;
  const runWriteStep = async (op, chunk) => {
    const result = await PluginAPI.executeNodeScript({
      script: `
        const fs = require('fs');
        const path = require('path');
        const filePath = path.join(args[0], args[1] + '_response.json');
        const tmpPath = filePath + '.tmp';
        const op = args[2];
        if (op === 'start') {
          fs.writeFileSync(tmpPath, '', { mode: 0o600 });
        } else if (op === 'append') {
          fs.appendFileSync(tmpPath, args[3], 'utf-8');
        } else if (op === 'finish') {
          try { fs.unlinkSync(filePath); } catch (e) {}
          fs.renameSync(tmpPath, filePath);
        } else {
          return { success: false, error: 'Unknown response write operation: ' + op };
        }
        return { success: true };
      `,
      args: [responseDir, commandId, op, chunk || ''],
      timeout: 5000,
    });
    assertNodeResult(result, 'writeResponse ' + op);
  };

  await runWriteStep('start');
  for (let i = 0; i < payload.length; i += chunkSize) {
    await runWriteStep('append', payload.slice(i, i + chunkSize));
  }
  await runWriteStep('finish');
}

async function deleteFile(filePath) {
  const result = await PluginAPI.executeNodeScript({
    script: `
      const fs = require('fs');
      fs.unlinkSync(args[0]);
      return { success: true };
    `,
    args: [filePath],
    timeout: 5000,
  });
  assertNodeResult(result, 'deleteFile');
}

async function executeCommand(command) {
  // Protocol version check
  if (command.protocolVersion > PROTOCOL_VERSION) {
    return {
      success: false,
      error: `Unsupported protocol version ${command.protocolVersion}. Plugin supports up to version ${PROTOCOL_VERSION}. Please update the plugin.`,
      timestamp: Date.now(),
    };
  }

  let result;
  const start = Date.now();
  try {
    switch (command.action) {
      case 'addTask': {
        const d = command.data || {};
        const title = d.title || '';

        // Parse @date syntax since PluginAPI.addTask doesn't process short syntax.
        // Use local date formatting (not toISOString which converts to UTC and shifts the day in positive timezones).
        const { dueDay, cleanTitle } = parseAtDateSyntax(title);

        const hasParent = !!d.parentId;
        const hasSyntax = hasParent && /[#\+]/.test(title);
        if (hasSyntax) {
          const parentClean = title.replace(/\s*[#\+]\S+/g, '').trim() || title;
          const taskId = await PluginAPI.addTask({ ...d, title: parentClean });
          await PluginAPI.updateTask(taskId, { title });
          result = taskId;
        } else {
          result = await PluginAPI.addTask({ ...d, title: cleanTitle });
        }

        // Set dueDay only — plannedAt is independent (due date ≠ planned for today).
        // Clear both when no @date syntax so inbox tasks don't inherit stale schedules.
        if (result && dueDay) {
          await PluginAPI.updateTask(result, { dueDay });
        } else if (result) {
          await PluginAPI.updateTask(result, { plannedAt: null, dueDay: null });
        }
        // PluginAPI.addTask() silently ignores fields outside its own known creation
        // set (same reason dueDay above needs a follow-up updateTask) — deadlineDay
        // passed via the initial addTask({ ...d }) spread never actually persists.
        if (result && 'deadlineDay' in d) {
          await PluginAPI.updateTask(result, { deadlineDay: d.deadlineDay });
        }
        break;
      }
      case 'getTasks': {
        let tasks = await PluginAPI.getTasks();
        if (command.filters && command.filters.includeArchived) {
          try {
            const archived = await PluginAPI.getArchivedTasks();
            tasks = tasks.concat(archived);
          } catch (e) {}
        }
        result = tasks;
        break;
      }
      case 'updateTask': {
        const updateData = command.data || {};
        // SP auto-sets plannedAt when dueDay changes. Preserve existing value unless
        // caller explicitly included plannedAt in the update.
        if ('dueDay' in updateData && !('plannedAt' in updateData)) {
          const allTasksForUpdate = await PluginAPI.getTasks();
          const taskForUpdate = allTasksForUpdate.find(t => t.id === command.taskId);
          const currentPlannedAt = taskForUpdate ? (taskForUpdate.plannedAt ?? null) : null;
          result = await PluginAPI.updateTask(command.taskId, { ...updateData, plannedAt: currentPlannedAt });
        } else {
          result = await PluginAPI.updateTask(command.taskId, updateData);
        }
        break;
      }
      case 'setTaskDone':
        result = await PluginAPI.updateTask(command.taskId, { isDone: true, doneOn: Date.now() });
        break;
      case 'getAllProjects':
        result = await PluginAPI.getAllProjects();
        break;
      case 'addProject':
        result = await PluginAPI.addProject(command.data || {});
        break;
      case 'updateProject':
        result = await PluginAPI.updateProject(command.projectId, command.data || {});
        break;
      case 'getAllTags':
        result = await PluginAPI.getAllTags();
        break;
      case 'addTag':
        result = await PluginAPI.addTag(command.data || {});
        break;
      case 'updateTag':
        result = await PluginAPI.updateTag(command.tagId, command.data || {});
        break;
      case 'showSnack':
        try {
          PluginAPI.showSnack({ msg: command.message || '', type: (command.data && command.data.type) || 'SUCCESS' });
        } catch (e) {
          console.log('Snack:', command.message);
        }
        result = { success: true };
        break;
      case 'addTagToTask': {
        // Read-modify-write: PluginAPI has no native addTagToTask; updateTask replaces tagIds
        // entirely so we must read the current list first to preserve existing tags (FR-001).
        // Both the read and write happen within a single JS event-loop turn — effectively atomic.
        const allTasksForAdd = await PluginAPI.getTasks();
        const taskForAdd = allTasksForAdd.find(t => t.id === command.taskId);
        if (!taskForAdd) {
          return { success: false, error: `Task not found: ${command.taskId}`, timestamp: Date.now() };
        }
        const currentTagIds = taskForAdd.tagIds || [];
        // Idempotent: calling with an already-present tag is a no-op (spec Assumption)
        if (!currentTagIds.includes(command.tagId)) {
          await PluginAPI.updateTask(command.taskId, { tagIds: [...currentTagIds, command.tagId] });
        }
        result = null;
        break;
      }
      case 'removeTagFromTask': {
        // Same read-modify-write rationale as addTagToTask.
        // Error (not silent) when tag is not on the task (FR-002, spec Assumption).
        const allTasksForRemove = await PluginAPI.getTasks();
        const taskForRemove = allTasksForRemove.find(t => t.id === command.taskId);
        if (!taskForRemove) {
          return { success: false, error: `Task not found: ${command.taskId}`, timestamp: Date.now() };
        }
        const tagsForRemove = taskForRemove.tagIds || [];
        if (!tagsForRemove.includes(command.tagId)) {
          return { success: false, error: `Tag ${command.tagId} not on task ${command.taskId}`, timestamp: Date.now() };
        }
        await PluginAPI.updateTask(command.taskId, { tagIds: tagsForRemove.filter(id => id !== command.tagId) });
        result = null;
        break;
      }
      case 'loadCurrentTask': {
        // Cannot use registerHook('currentTaskChange') — it breaks plugin polling.
        // Instead, scan tasks for active timer via currentTimestamp field.
        const allTasksCurrent = await PluginAPI.getTasks();
        const active = allTasksCurrent.find(t => t.currentTimestamp > 0) || null;
        result = active ? { id: active.id, title: active.title, isDone: active.isDone, projectId: active.projectId, parentId: active.parentId, tagIds: active.tagIds, dueDay: active.dueDay } : null;
        break;
      }
      case 'moveTaskToProject': {
        // updateTask({ projectId }) triggers SP's NgRx reducer to update project.taskIds
        // automatically. Only valid for top-level tasks; subtasks belong to their parent (FR-008).
        const allTasksForMove = await PluginAPI.getTasks();
        const taskForMove = allTasksForMove.find(t => t.id === command.taskId);
        if (!taskForMove) {
          return { success: false, error: `Task not found: ${command.taskId}`, timestamp: Date.now() };
        }
        if (taskForMove.parentId) {
          return { success: false, error: `Cannot move subtask: ${command.taskId} has parentId ${taskForMove.parentId}`, timestamp: Date.now() };
        }
        const allProjects = await PluginAPI.getAllProjects();
        if (!allProjects.find(p => p.id === command.projectId)) {
          return { success: false, error: `Project not found: ${command.projectId}`, timestamp: Date.now() };
        }
        await PluginAPI.updateTask(command.taskId, { projectId: command.projectId });
        result = null;
        break;
      }
      case 'reorderTasks': {
        // Validate ALL taskIds belong to contextId before calling reorderTasks —
        // partial apply would silently corrupt the order (spec edge case requirement).
        const { taskIds, contextId, contextType } = command;
        const allTasksForReorder = await PluginAPI.getTasks();
        for (const id of taskIds) {
          const t = allTasksForReorder.find(t => t.id === id);
          const belongsToContext = t && (contextType === 'parent' ? t.parentId === contextId : t.projectId === contextId);
          if (!belongsToContext) {
            return { success: false, error: `Task ${id} does not belong to context ${contextId}`, timestamp: Date.now() };
          }
        }
        // PluginAPI uses 'task' not 'parent' for subtask context
        const apiContextType = contextType === 'parent' ? 'task' : contextType;
        await PluginAPI.reorderTasks(taskIds, contextId, apiContextType);
        result = null;
        break;
      }
      case 'bulkCompleteTasks': {
        const allTasksForComplete = await PluginAPI.getTasks();
        const results = [];
        for (const id of (command.taskIds || [])) {
          const task = allTasksForComplete.find(t => t.id === id);
          if (!task) {
            results.push({ id, success: false, error: `Task not found: ${id}` });
          } else {
            try {
              await PluginAPI.updateTask(id, { isDone: true, doneOn: Date.now() });
              results.push({ id, success: true });
            } catch (e) {
              results.push({ id, success: false, error: e.message || String(e) });
            }
          }
        }
        result = { results };
        break;
      }
      case 'bulkUpdateTasks': {
        // PluginAPI.updateTask() no-ops (doesn't throw) for a nonexistent taskId — same
        // quirk startTask works around below — so an invalid task_id here would silently
        // report success without a pre-check, contradicting the partial-success spec.
        const allTaskIdsForBulkUpdate = new Set((await PluginAPI.getTasks()).map(t => t.id));
        const results = [];
        for (const item of (command.updates || [])) {
          if (!allTaskIdsForBulkUpdate.has(item.taskId)) {
            results.push({ id: item.taskId, success: false, error: `Task not found: ${item.taskId}` });
            continue;
          }
          try {
            await PluginAPI.updateTask(item.taskId, item.data || {});
            results.push({ id: item.taskId, success: true });
          } catch (e) {
            results.push({ id: item.taskId, success: false, error: e.message || String(e) });
          }
        }
        result = { results };
        break;
      }
      case 'startTask': {
        // PluginAPI has no native timer control method, and dispatchAction has a whitelist
        // that doesn't include task actions. Instead, we use updateTask to set currentTimestamp
        // which is how SP internally tracks the active timer.
        const allTasksForStart = await PluginAPI.getTasks();
        const taskForStart = allTasksForStart.find(t => t.id === command.taskId);
        if (!taskForStart) {
          return { success: false, error: `Task not found: ${command.taskId}`, timestamp: Date.now() };
        }
        if (taskForStart.isDone) {
          return { success: false, error: `Cannot start tracking a completed task: ${command.taskId}`, timestamp: Date.now() };
        }
        // Stop any currently running task first
        const currentlyTracked = allTasksForStart.find(t => t.currentTimestamp > 0 && t.id !== command.taskId);
        if (currentlyTracked) {
          await PluginAPI.updateTask(currentlyTracked.id, { currentTimestamp: null });
        }
        await PluginAPI.updateTask(command.taskId, { currentTimestamp: Date.now() });
        result = null;
        break;
      }
      case 'stopTask': {
        // Find the currently tracked task and clear its currentTimestamp.
        const allTasksForStop = await PluginAPI.getTasks();
        const tracked = allTasksForStop.find(t => t.currentTimestamp > 0);
        if (tracked) {
          await PluginAPI.updateTask(tracked.id, { currentTimestamp: null });
        }
        // Idempotent — no error if nothing is being tracked
        result = null;
        break;
      }
      case 'logTime':
      case 'logTimeEntries': {
        // PluginAPI has no addTimeSpent equivalent, and updateTask() silently no-ops on
        // an unknown id (the quirk bulkUpdateTasks and startTask guard against), so the
        // task has to be looked up before anything is written.
        const logData = command.data || {};
        // 'logTime' is the older single-day shape; normalise it so there is one code path.
        const logEntries = logData.entries || [{ date: logData.date, durationMs: logData.durationMs }];
        const allTasksForLog = await PluginAPI.getTasks();
        const taskForLog = allTasksForLog.find(t => t.id === command.taskId);
        if (!taskForLog) {
          return { success: false, error: `Task not found: ${command.taskId}`, timestamp: Date.now() };
        }

        const existingDays = taskForLog.timeSpentOnDay || {};
        // SP always derives timeSpent from this map. A task whose stored total
        // disagrees came from outside SP's reducers; recomputing corrects it, and
        // the old value is reported back so the correction isn't silent.
        const sumBefore = sumDayMap(existingDays);

        const dayChanges = [];
        const parentDeltas = [];
        for (const entry of logEntries) {
          const previous = existingDays[entry.date] || 0;
          const next = logData.mode === 'set' ? entry.durationMs : previous + entry.durationMs;
          dayChanges.push({ date: entry.date, ms: next });
          if (next !== previous) parentDeltas.push({ date: entry.date, delta: next - previous });
        }

        const updated = applyDayTimes(existingDays, dayChanges);
        await PluginAPI.updateTask(command.taskId, updated);

        // SP treats a parent's tracked time as the aggregate of its subtasks, so the same
        // deltas have to land on the parent — otherwise the parent and get_worklog's
        // project totals drift from the subtask that actually recorded the work. All the
        // affected days go in one update rather than one write per day.
        if (taskForLog.parentId && parentDeltas.length) {
          const parentForLog = allTasksForLog.find(t => t.id === taskForLog.parentId);
          if (parentForLog) {
            const parentDays = parentForLog.timeSpentOnDay || {};
            const parentChanges = parentDeltas.map(function (d) {
              return { date: d.date, ms: Math.max(0, (parentDays[d.date] || 0) + d.delta) };
            });
            await PluginAPI.updateTask(parentForLog.id, applyDayTimes(parentDays, parentChanges));
          }
        }

        result = {
          taskId: command.taskId,
          dates: logEntries.map(function (e) { return e.date; }),
          timeSpentOnDay: updated.timeSpentOnDay,
          timeSpent: updated.timeSpent,
        };
        if (taskForLog.timeSpent !== sumBefore) result.previousTimeSpent = taskForLog.timeSpent;
        break;
      }
      case 'deleteTask': {
        const allTasksForDelete = await PluginAPI.getTasks();
        const taskToDelete = allTasksForDelete.find(t => t.id === command.taskId);
        if (!taskToDelete) {
          return { success: false, error: `Task not found: ${command.taskId}`, timestamp: Date.now() };
        }
        await PluginAPI.deleteTask(command.taskId);
        result = null;
        break;
      }
      case 'createTaskWithSubtasks': {
        const parentData = command.data || {};
        const parentId = await PluginAPI.addTask({
          title: parentData.title,
          notes: parentData.notes || '',
          projectId: parentData.projectId || undefined,
          tagIds: parentData.tagIds || [],
        });
        const subtaskIds = [];
        for (const sub of (parentData.subtasks || [])) {
          const subId = await PluginAPI.addTask({
            title: sub.title,
            notes: sub.notes || '',
            parentId,
          });
          subtaskIds.push(subId);
        }
        result = { parentId, subtaskIds };
        break;
      }
      case 'getTaskRepeatCfgs': {
        const state = await PluginAPI.getAppState();
        // SP stores taskRepeatCfgs as { [id]: cfg } — convert to array so MCP consumers
        // don't need to know the internal map shape (consistent with get_projects / get_tags).
        const cfgMap = (state && state.taskRepeatCfgs) || {};
        result = Object.values(cfgMap);
        break;
      }
      case 'getAllHabits': {
        const habitApiError = missingHabitApiError();
        if (habitApiError) return { success: false, error: habitApiError, timestamp: Date.now() };
        const allCounters = await PluginAPI.getAllSimpleCounters();
        // Habit tools only manage streak-tracked click counters — StopWatch and
        // RepeatedCountdownReminder are a different SP feature sharing this same store.
        result = (allCounters || []).filter(c => c.type === 'ClickCounter');
        break;
      }
      case 'addHabit': {
        const habitApiError = missingHabitApiError();
        if (habitApiError) return { success: false, error: habitApiError, timestamp: Date.now() };
        const dHabit = command.data || {};
        // No native create call. setSimpleCounterDate throws if the id doesn't exist yet
        // (it's absolute-set, not upsert) — setCounter is the one that upserts-on-missing,
        // creating a default ClickCounter. updateSimpleCounter immediately after applies
        // the caller's real config before anything else can observe the placeholder state.
        const newHabitId = 'habit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        await PluginAPI.setCounter(newHabitId, 0);
        const habitCfg = { title: dHabit.title, type: 'ClickCounter' };
        if (dHabit.icon !== undefined) habitCfg.icon = dHabit.icon;
        if (dHabit.isTrackStreaks !== undefined) habitCfg.isTrackStreaks = dHabit.isTrackStreaks;
        if (dHabit.streakMode !== undefined) habitCfg.streakMode = dHabit.streakMode;
        if (dHabit.streakMinValue !== undefined) habitCfg.streakMinValue = dHabit.streakMinValue;
        if (dHabit.streakWeekDays !== undefined) habitCfg.streakWeekDays = dHabit.streakWeekDays;
        if (dHabit.streakWeeklyFrequency !== undefined) habitCfg.streakWeeklyFrequency = dHabit.streakWeeklyFrequency;
        await PluginAPI.updateSimpleCounter(newHabitId, habitCfg);
        result = newHabitId;
        break;
      }
      case 'updateHabit': {
        const habitApiError = missingHabitApiError();
        if (habitApiError) return { success: false, error: habitApiError, timestamp: Date.now() };
        const existingForUpdate = await PluginAPI.getSimpleCounter(command.habitId);
        if (!existingForUpdate) {
          return { success: false, error: `Habit not found: ${command.habitId}`, timestamp: Date.now() };
        }
        await PluginAPI.updateSimpleCounter(command.habitId, command.data || {});
        result = null;
        break;
      }
      case 'setHabitValue': {
        const habitApiError = missingHabitApiError();
        if (habitApiError) return { success: false, error: habitApiError, timestamp: Date.now() };
        const dSetValue = command.data || {};
        // Default "today" is computed here (plugin/Electron-renderer clock), not by the
        // MCP server — the server and SP can run on different machines/timezones, and
        // this must agree with checkHabit's default for the same reason.
        const setValueDate = dSetValue.date || todayLocalDateStr();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(setValueDate)) {
          return { success: false, error: 'Invalid date format: use YYYY-MM-DD', timestamp: Date.now() };
        }
        const existingForSetValue = await PluginAPI.getSimpleCounter(command.habitId);
        if (!existingForSetValue) {
          return { success: false, error: `Habit not found: ${command.habitId}`, timestamp: Date.now() };
        }
        await PluginAPI.setSimpleCounterDate(command.habitId, setValueDate, dSetValue.value);
        result = null;
        break;
      }
      case 'checkHabit': {
        const habitApiError = missingHabitApiError();
        if (habitApiError) return { success: false, error: habitApiError, timestamp: Date.now() };
        const dCheck = command.data || {};
        const checkDate = dCheck.date || todayLocalDateStr();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(checkDate)) {
          return { success: false, error: 'Invalid date format: use YYYY-MM-DD', timestamp: Date.now() };
        }
        const existingForCheck = await PluginAPI.getSimpleCounter(command.habitId);
        if (!existingForCheck) {
          return { success: false, error: `Habit not found: ${command.habitId}`, timestamp: Date.now() };
        }
        // Mirrors the Habit Tracker UI's own click behavior: increment the day's
        // count, don't overwrite it — toggleSimpleCounter is unrelated (StopWatch-only).
        const currentValue = (existingForCheck.countOnDay && existingForCheck.countOnDay[checkDate]) || 0;
        await PluginAPI.setSimpleCounterDate(command.habitId, checkDate, currentValue + 1);
        result = currentValue + 1;
        break;
      }
      case 'deleteHabit': {
        const habitApiError = missingHabitApiError();
        if (habitApiError) return { success: false, error: habitApiError, timestamp: Date.now() };
        const existingForDelete = await PluginAPI.getSimpleCounter(command.habitId);
        if (!existingForDelete) {
          return { success: false, error: `Habit not found: ${command.habitId}`, timestamp: Date.now() };
        }
        await PluginAPI.deleteSimpleCounter(command.habitId);
        result = null;
        break;
      }
      case 'ping':
        result = { pong: true, pluginVersion: PLUGIN_VERSION, protocolVersion: PROTOCOL_VERSION };
        break;
      default:
        return { success: false, error: `Unknown command action: ${command.action}`, timestamp: Date.now() };
    }
    return { success: true, result, executionTime: Date.now() - start, timestamp: Date.now() };
  } catch (e) {
    return { success: false, error: e.message || String(e), timestamp: Date.now() };
  }
}

async function pollCommands() {
  if (!commandDir) return;
  try {
    const result = await PluginAPI.executeNodeScript({
      script: `
        const fs = require('fs');
        const path = require('path');
        const dir = args[0];
        const since = args[1];
        if (!fs.existsSync(dir)) return { success: true, commands: [] };
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
        const cmds = [];
        for (const f of files) {
          const fp = path.join(dir, f);
          try {
            const stat = fs.statSync(fp);
            if (stat.mtimeMs >= since) {
              cmds.push({ file: f, path: fp, data: JSON.parse(fs.readFileSync(fp, 'utf-8')), mtime: stat.mtimeMs });
            }
          } catch (e) {}
        }
        cmds.sort((a, b) => a.mtime - b.mtime);
        return { success: true, commands: cmds };
      `,
      args: [commandDir, lastProcessed],
      timeout: 10000,
    });
    const r = unwrapNodeResult(result);
    if (!r || !r.success || !r.commands) return;
    for (const cmd of r.commands) {
      const cmdId = cmd.data.id || cmd.file.replace('.json', '');
      try {
        const response = await executeCommand(cmd.data);
        await writeResponse(cmdId, response);
      } catch (e) {
        console.error('Command processing failed (' + (cmd.data && cmd.data.action) + '):', e);
        try {
          await writeResponse(cmdId, { success: false, error: e.message || String(e), timestamp: Date.now() });
        } catch (_) {}
      }
      lastProcessed = Math.max(lastProcessed, cmd.mtime);
      try {
        await deleteFile(cmd.path);
      } catch (e) {
        console.error('deleteFile failed:', e);
      }
    }
  } catch (e) {
    console.error('Poll error:', e);
  }
}

async function init() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  await setupDirectories();
  // FR-020: Clean stale files on startup (>5min old)
  await PluginAPI.executeNodeScript({
    script: `
      const fs = require('fs');
      const path = require('path');
      const now = Date.now();
      for (const dir of [args[0], args[1]]) {
        try {
          for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
            const fp = path.join(dir, f);
            if (now - fs.statSync(fp).mtimeMs > 300000) fs.unlinkSync(fp);
          }
        } catch (e) {}
      }
      return { success: true };
    `,
    args: [commandDir, responseDir],
    timeout: 5000,
  });
  pollTimer = setInterval(pollCommands, POLL_INTERVAL_MS);
  console.log('MCP Bridge Plugin initialized', { commandDir, responseDir });
}

// onReady fires after SP confirms the Node.js IPC bridge is available (with retry).
// Fall back to setTimeout for SP < 18.6.0 which lacks onReady.
// Guarded so this file can be `require`d in a Node/test environment without a PluginAPI global.
if (typeof PluginAPI !== 'undefined' && typeof PluginAPI.onReady === 'function') {
  PluginAPI.onReady(init);
} else if (typeof PluginAPI !== 'undefined') {
  setTimeout(init, 500);
}
