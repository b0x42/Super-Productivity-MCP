// MCP Bridge Plugin for Super Productivity
const PROTOCOL_VERSION = 1;
const POLL_INTERVAL_MS = 2000;
let commandDir = null;
let responseDir = null;
let pollTimer = null;
let lastProcessed = 0;

async function setupDirectories() {
  const result = await PluginAPI.executeNodeScript({
    script: `
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const home = os.homedir();
      const APP = 'super-productivity-mcp';
      let candidates;
      if (os.platform() === 'darwin') {
        candidates = [
          path.join(home, 'Library', 'Containers', 'com.superproductivity.app', 'Data', 'Library', 'Application Support', APP),
          path.join(home, 'Library', 'Application Support', APP)
        ];
      } else if (os.platform() === 'win32') {
        candidates = [path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), APP)];
      } else {
        candidates = [
          path.join(home, 'snap', 'superproductivity', 'current', '.local', 'share', APP),
          path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), APP)
        ];
      }
      // Check for mcp_config.json override
      for (const p of candidates) {
        try {
          const cfg = path.join(p, 'mcp_config.json');
          if (fs.existsSync(cfg)) {
            const c = JSON.parse(fs.readFileSync(cfg, 'utf-8'));
            if (c.dataDir && fs.existsSync(c.dataDir)) {
              const cd = path.join(c.dataDir, 'plugin_commands');
              const rd = path.join(c.dataDir, 'plugin_responses');
              if (!fs.existsSync(cd)) fs.mkdirSync(cd, { recursive: true, mode: 0o700 });
              if (!fs.existsSync(rd)) fs.mkdirSync(rd, { recursive: true, mode: 0o700 });
              return { success: true, commandDir: cd, responseDir: rd };
            }
          }
        } catch (e) {}
      }
      // Probe candidates
      for (const p of candidates) {
        try {
          if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true, mode: 0o700 });
          const cd = path.join(p, 'plugin_commands');
          const rd = path.join(p, 'plugin_responses');
          if (!fs.existsSync(cd)) fs.mkdirSync(cd, { recursive: true, mode: 0o700 });
          if (!fs.existsSync(rd)) fs.mkdirSync(rd, { recursive: true, mode: 0o700 });
          return { success: true, commandDir: cd, responseDir: rd };
        } catch (e) {}
      }
      return { success: false, error: 'No writable directory found' };
    `,
    args: [],
    timeout: 10000,
  });
  // executeNodeScript wraps result: could be result.result.success or result.success
  let r = result;
  if (r && r.success && r.result && typeof r.result === 'object') r = r.result;
  if (r && r.success) {
    commandDir = r.commandDir;
    responseDir = r.responseDir;
  } else {
    throw new Error(r ? r.error : 'Directory setup failed');
  }
}

async function writeResponse(commandId, response) {
  await PluginAPI.executeNodeScript({
    script: `
      const fs = require('fs');
      const path = require('path');
      fs.writeFileSync(path.join(args[0], args[1] + '_response.json'), JSON.stringify(args[2], null, 2), { mode: 0o600 });
      return { success: true };
    `,
    args: [responseDir, commandId, response],
    timeout: 5000,
  });
}

async function deleteFile(filePath) {
  await PluginAPI.executeNodeScript({
    script: `require('fs').unlinkSync(args[0]); return { success: true };`,
    args: [filePath],
    timeout: 5000,
  });
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
        const dateMatch = title.match(/@(\S+)(?:\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?/i);
        let dueDay = null;
        const localDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        if (dateMatch) {
          const keyword = dateMatch[1].toLowerCase();
          const now = new Date();
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
            const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
            const idx = dayNames.indexOf(keyword);
            if (idx !== -1) {
              const diff = (idx - now.getDay() + 7) % 7 || 7;
              today.setDate(today.getDate() + diff);
              dueDay = localDateStr(today);
            }
          }
        }

        // Strip @syntax from title for clean display
        const cleanTitle = dueDay ? title.replace(/@\S+(\s+\d{1,2}(:\d{2})?\s*(am|pm)?)?/i, '').trim() : title;

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

        // Set dueDay + plannedAt for Today, or clear plannedAt for Inbox
        if (result && dueDay) {
          await PluginAPI.updateTask(result, { dueDay, plannedAt: Date.now() });
        } else if (result) {
          await PluginAPI.updateTask(result, { plannedAt: null, dueDay: null });
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
      case 'updateTask':
        result = await PluginAPI.updateTask(command.taskId, command.data || {});
        break;
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
        result = null;
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
        // Validate tagId exists in SP registry — silently appending an unknown tag would violate SC-003.
        const allTagsForAdd = await PluginAPI.getAllTags();
        if (!allTagsForAdd.find(t => t.id === command.tagId)) {
          return { success: false, error: `Tag not found: ${command.tagId}`, timestamp: Date.now() };
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
        // Validate tagId exists in SP registry — consistent with addTagToTask validation.
        const allTagsForRemove = await PluginAPI.getAllTags();
        if (!allTagsForRemove.find(t => t.id === command.tagId)) {
          return { success: false, error: `Tag not found: ${command.tagId}`, timestamp: Date.now() };
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
        // Retrieve the currently time-tracked task stored by the currentTaskChange hook.
        // persistDataSynced is single-slot string storage — sufficient since only one task
        // can be active at a time. Returns null when no timer is running (FR-010).
        const raw = await PluginAPI.loadSyncedData();
        try {
          result = raw ? JSON.parse(raw) : null;
        } catch (e) {
          return { success: false, error: 'Failed to parse stored current task', timestamp: Date.now() };
        }
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
        if (taskForMove.projectId === command.projectId) {
          return { success: false, error: `Task ${command.taskId} already in project ${command.projectId}`, timestamp: Date.now() };
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
        // Validate contextId exists before checking task membership.
        if (contextType === 'project') {
          const allProjectsForReorder = await PluginAPI.getAllProjects();
          if (!allProjectsForReorder.find(p => p.id === contextId)) {
            return { success: false, error: `Context not found: ${contextId}`, timestamp: Date.now() };
          }
        }
        const allTasksForReorder = await PluginAPI.getTasks();
        if (contextType === 'parent' && !allTasksForReorder.find(t => t.id === contextId)) {
          return { success: false, error: `Context not found: ${contextId}`, timestamp: Date.now() };
        }
        if (!Array.isArray(taskIds)) {
          return { success: false, error: 'taskIds must be an array', timestamp: Date.now() };
        }
        for (const id of taskIds) {
          const taskToCheck = allTasksForReorder.find(t => t.id === id);
          const belongsToContext = taskToCheck && (contextType === 'parent' ? taskToCheck.parentId === contextId : taskToCheck.projectId === contextId);
          if (!belongsToContext) {
            return { success: false, error: `Task ${id} does not belong to context ${contextId}`, timestamp: Date.now() };
          }
        }
        await PluginAPI.reorderTasks(taskIds, contextId, contextType);
        result = null;
        break;
      }
      case 'ping':
        result = { pong: true, pluginVersion: '1.0.0', protocolVersion: PROTOCOL_VERSION };
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
            if (stat.mtimeMs > since) {
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
    const r = result && result.success && result.result && typeof result.result === 'object' ? result.result : result;
    if (!r || !r.success || !r.commands) return;
    for (const cmd of r.commands) {
      try {
        const response = await executeCommand(cmd.data);
        await writeResponse(cmd.data.id || cmd.file.replace('.json', ''), response);
        await deleteFile(cmd.path);
        lastProcessed = Math.max(lastProcessed, cmd.mtime);
      } catch (e) {
        console.error('Command failed:', e);
      }
    }
  } catch (e) {
    console.error('Poll error:', e);
  }
}

// Initialize with retry — nodeExecution permission may not be ready on first plugin activation
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;

async function init() {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
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
      // Seed currentTask as null to clear stale data from previous sessions.
      // The currentTaskChange hook will overwrite this with the real value on the next change.
      // If SP already has an active timer at plugin load, the hook fires once SP dispatches
      // the current-task state; until then, get_current_task returns null (safe default).
      PluginAPI.persistDataSynced(JSON.stringify(null));
      // Store current task on change so loadCurrentTask can return it instantly (O(1) lookup).
      // persistDataSynced is single-slot string storage; single arg only — do NOT pass a key name.
      PluginAPI.registerHook('currentTaskChange', (payload) => {
        // Store only known task fields to avoid leaking SP internals and to keep the payload stable.
        const t = payload.current;
        const stored = t ? { id: t.id, title: t.title, isDone: t.isDone, projectId: t.projectId, parentId: t.parentId, tagIds: t.tagIds, dueDay: t.dueDay } : null;
        PluginAPI.persistDataSynced(JSON.stringify(stored));
      });
      pollTimer = setInterval(pollCommands, POLL_INTERVAL_MS);
      console.log('MCP Bridge Plugin initialized');
      return;
    } catch (e) {
      console.error('MCP Bridge init attempt ' + attempt + '/' + MAX_RETRIES + ' failed:', e);
      if (attempt < MAX_RETRIES) {
        await new Promise(function(r) { setTimeout(r, RETRY_DELAY_MS); });
      }
    }
  }
  console.error('MCP Bridge init failed after all retries');
}

// Delay first attempt to let SP finish granting permissions
setTimeout(init, 1500);
