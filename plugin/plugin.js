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

        // Parse @date syntax since PluginAPI.addTask doesn't process short syntax
        const dateMatch = title.match(/@(\S+)(?:\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?/i);
        let dueDay = null;
        if (dateMatch) {
          const keyword = dateMatch[1].toLowerCase();
          const now = new Date();
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          if (keyword === 'today' || keyword === '0days') {
            dueDay = today.toISOString().slice(0, 10);
          } else if (keyword === 'tomorrow' || keyword === '1days') {
            today.setDate(today.getDate() + 1);
            dueDay = today.toISOString().slice(0, 10);
          } else if (/^\d+days?$/.test(keyword)) {
            const days = parseInt(keyword);
            today.setDate(today.getDate() + days);
            dueDay = today.toISOString().slice(0, 10);
          } else {
            const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
            const idx = dayNames.indexOf(keyword);
            if (idx !== -1) {
              const diff = (idx - now.getDay() + 7) % 7 || 7;
              today.setDate(today.getDate() + diff);
              dueDay = today.toISOString().slice(0, 10);
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
        result = { success: true };
        break;
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

// Initialize
(async () => {
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
    pollTimer = setInterval(pollCommands, POLL_INTERVAL_MS);
    console.log('MCP Bridge Plugin initialized');
  } catch (e) {
    console.error('MCP Bridge init failed:', e);
  }
})();
