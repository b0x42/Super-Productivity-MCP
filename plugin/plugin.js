// MCP Bridge Plugin for Super Productivity
const PROTOCOL_VERSION = 1;
// Kept in step with plugin/manifest.json by tests/unit/plugin/version.test.ts —
// this was a literal in the ping handler and check_connection reported 1.6.0
// from a 1.7.0 plugin for a whole release.
const PLUGIN_VERSION = '1.7.0-http-1.0.0';
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
  module.exports = {
    parseAtDateSyntax,
    executeCommand,
    PLUGIN_VERSION,
    normalizeHttpSettings,
    syncHttpConfig,
    showTokenDialog,
    buildPanelModel,
    restartServer,
    startServerByUser,
    stopServerByUser,
    stopManagedServer,
    // Test seams: the data dir is normally discovered by init() via executeNodeScript, and the
    // embedded server is filled in by the build.
    __setCommandDirForTest: (dir) => {
      commandDir = dir;
      lastPublishedHttpConfig = null;
      lastHttpConfigError = null;
      lastStatusToastKey = null;
      cachedToken = null;
      lastPanelBody = null;
      lastPanelAt = 0;
      lastControlId = null;
      controlAck = null;
      currentHttp = null;
      serverBundlePath = null;
      spMainPid = undefined;
      lastLaunchAt = 0;
      recentLaunches = [];
      userStopped = false;
      launchBlocked = false;
      externalNoticeShown = false;
      weMayHaveServer = false;
      opChain = Promise.resolve();
      stoppedPids.clear();
    },
    __setEmbeddedServerForTest: (e) => { embeddedServer = e; serverBundlePath = null; },
  };
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

// PluginAPI exposes getArchivedTasks() for reading but nothing that removes from
// the archive, so an archived task can be seen and never deleted. Reporting it as
// "not found" is misleading for a task get_tasks will happily return — name the
// real reason and say where deletion is possible. Probed defensively: older SP
// builds may not expose the archive at all, and a failure here must not turn a
// clear error into a thrown one.
async function archivedTaskError(taskId) {
  if (typeof PluginAPI.getArchivedTasks !== 'function') return null;
  try {
    const archived = await PluginAPI.getArchivedTasks();
    if (!archived.some(t => t.id === taskId)) return null;
    return `Task ${taskId} is archived. Archived tasks cannot be deleted through the plugin API — remove it from the archive in Super Productivity.`;
  } catch (e) {
    return null;
  }
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
        // Native macOS builds use ~/Library/Application Support. Keep the
        // Mac App Store container as a fallback, but do not let a stale Store
        // directory shadow a working native installation.
        candidates = [
          path.join(home, 'Library', 'Application Support', APP),
          path.join(home, 'Library', 'Containers', 'com.super-productivity.app', 'Data', 'Library', 'Application Support', APP)
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

// ---------------------------------------------------------------------------
// Streamable HTTP server (specs/009-streamable-http: 009-FR-001 … 009-FR-022)
//
// The settings dialog (config-schema.json) is mirrored to http_config.json in the shared data
// directory; the server follows that file live, so changing a setting never needs a restart.
// In the other direction the server writes http_status.json (state, errors, a heartbeat), which
// is how a failure only it can see — a busy port — reaches the user as a toast.
//
// The plugin also owns the server process. It ships the server inside this file (EMBEDDED_SERVER,
// filled in by scripts/build-plugin.mjs), writes it to the data dir, and launches it detached with
// SP's own Node (process.execPath + ELECTRON_RUN_AS_NODE — plugin scripts get no PATH, so npx or
// "node" are not an option). Liveness is the status file's heartbeat; the server exits on its own
// if SP dies (--parent-pid). `super-productivity-mcp --http` still works for running it yourself.
//
// Validation mirrors src/http/config.ts; the server re-validates regardless.
//
// How SP runs executeNodeScript matters here (electron/plugin-node-executor.ts): a script that
// matches /require\((?!fs|path|os)|child_process|exec|spawn|eval|Function|process\.exit/ gets a
// real Node process; every other script runs in a vm sandbox with only fs/path/os and NO `process`.
// So steady-state polling stays in the cheap sandbox, and scripts that need `process` say
// `const process = require('process')` — which is also what selects the real-process mode.
//
// The bearer token is a credential. The settings dialog saves into SP's synced state (exports,
// backups, other devices), so it can't take one. The plugin generates the token, keeps it in SP's
// local-only secret store, and delivers it through the owner-only (0600) http_config.json.
// ---------------------------------------------------------------------------
const HTTP_CONFIG_FILENAME = 'http_config.json';
const HTTP_STATUS_FILENAME = 'http_status.json';
const HTTP_LOG_FILENAME = 'http_server.log';
const TOKEN_SECRET_KEY = 'httpToken';
const TOKEN_RE = /^[\x21-\x7e]{16,256}$/;
const DEFAULT_HTTP_HOST = '127.0.0.1';
const DEFAULT_HTTP_PORT = 8765;
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const HTTP_PANEL_FILENAME = 'http_panel.json';     // plugin -> pane: what to show (plain text, no secrets)
const HTTP_CONTROL_FILENAME = 'http_control.json'; // pane -> plugin: one request, consumed on read
const PANEL_HEARTBEAT_MS = 10000;                  // rewritten at least this often so the pane can tell the plugin is alive
const BTN_CLOSE = 'Close';
const BTN_ROTATE = 'Generate new token';
const PANEL_NAME = 'SP MCP Server';                // the plugin's sidebar entry, where the controls live
const HEARTBEAT_FRESH_MS = 20000; // the server rewrites its status every 5s; older than this = not alive
const LAUNCH_GRACE_MS = 15000;    // time a fresh launch gets to write its first status
const MAX_LAUNCHES = 3;           // launches within LAUNCH_WINDOW_MS before we stop relaunching
const LAUNCH_WINDOW_MS = 120000;
const UPLOAD_CHUNK = 32 * 1024;   // SP caps a script at 100KB; args travel inside it

// Replaced at build time with the gzip+base64 server bundle. Empty in a source checkout, where
// the plugin publishes settings but leaves launching to a hand-run `super-productivity-mcp --http`.
const EMBEDDED_SERVER = { sha256: '', gzB64: '' };
let embeddedServer = EMBEDDED_SERVER;

let lastPublishedHttpConfig = null; // JSON string of what is on disk (includes the token)
let lastHttpConfigError = null;
let lastStatusToastKey = null;
let cachedToken = null;
let httpSyncInFlight = false;
let currentHttp = null;             // { config, manage, requireToken, tokenPublished } from the latest sync
let lastPanelBody = null;
let lastPanelAt = 0;
let lastControlId = null;           // a request id is acted on once, even if its file is somehow written again
let controlAck = null;              // last request id handled; the pane waits for it
let serverBundlePath = null;
let spMainPid;                      // undefined = not asked yet, null = could not tell
let lastLaunchAt = 0;
let recentLaunches = [];
let userStopped = false;            // the user pressed Stop: don't relaunch behind their back
let launchBlocked = false;          // gave up relaunching (crash loop / bundle failure) until the user acts
let externalNoticeShown = false;
let weMayHaveServer = false;        // we launched one (or saw ours): worth reading the status file even while HTTP is off
let opChain = Promise.resolve();    // launching, stopping and restarting never overlap
const stoppedPids = new Map();      // pid -> when we confirmed it gone: its status file may never say so itself

function serial(fn) {
  const run = opChain.then(fn, fn);
  opChain = run.catch(() => {});
  return run;
}

function hasEmbeddedServer() {
  return !!(embeddedServer && embeddedServer.gzB64 && embeddedServer.sha256);
}

function dataDirOf() {
  return commandDir ? commandDir.replace(/[\\/][^\\/]*$/, '') : '';
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function offHttpConfig() {
  return { enabled: false, host: DEFAULT_HTTP_HOST, port: DEFAULT_HTTP_PORT, allowedHosts: [], allowedOrigins: [] };
}

function isLoopbackBind(host) {
  const h = String(host).trim().toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
}

function isValidHttpHost(host) {
  if (HOSTNAME_RE.test(host)) return true; // hostnames and IPv4 literals
  return /^[0-9a-f:.]+$/i.test(host) && host.split(':').length >= 3; // IPv6 literal
}

// Canonical form of one allowed-Host entry, or null. Mirrors normalizeAllowedHost in src/http/config.ts.
function normalizeAllowedHost(raw) {
  const v = String(raw).trim().toLowerCase();
  const m = /^(\[[0-9a-f:.]+\]|[^:\[\]]+)(?::(\d{1,5}))?$/.exec(v);
  if (!m) return null;
  const name = m[1];
  const port = m[2];
  if (name.charAt(0) === '[') {
    try { new URL('http://' + name + '/'); } catch (e) { return null; } // URL parsing validates IPv6
  } else if (!HOSTNAME_RE.test(name)) {
    return null;
  }
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return null;
  return v;
}

// Canonical form of one allowed-Origin entry (scheme://host[:port], nothing else), or null.
// Mirrors normalizeAllowedOrigin in src/http/config.ts.
function normalizeAllowedOrigin(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch (e) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/') return null;
  return u.origin;
}

// Settings fields are free text: split on commas and whitespace, normalize, de-duplicate.
function parseSettingList(raw, normalize, errorFor) {
  if (raw === undefined || raw === null || raw === '') return { list: [] };
  if (typeof raw !== 'string') return { list: [], error: errorFor(raw) };
  const out = [];
  const entries = raw.split(/[\s,]+/).filter(Boolean);
  for (let i = 0; i < entries.length; i++) {
    const norm = normalize(entries[i]);
    if (norm === null) return { list: [], error: errorFor(entries[i]) };
    if (out.indexOf(norm) === -1) out.push(norm);
  }
  return { list: out };
}

// savedStr is what PluginAPI.loadSyncedData() returns: the settings dialog stores
// { config: {...}, savedAt } as one JSON string. Anything missing or malformed
// means "off" — an invalid enabled config fails closed rather than binding to a
// default the user did not pick.
//   requireToken: opt-in (off by default; best practice to turn on, especially beyond loopback)
//   manage:       the plugin starts/stops the server process (on by default)
function normalizeHttpSettings(savedStr) {
  const off = offHttpConfig();
  let cfg = null;
  if (typeof savedStr === 'string' && savedStr) {
    try {
      const parsed = JSON.parse(savedStr);
      if (parsed && typeof parsed === 'object' && parsed.config && typeof parsed.config === 'object') cfg = parsed.config;
    } catch (e) { /* unreadable settings = never configured */ }
  }
  const requireToken = !!cfg && cfg.httpRequireToken === true;
  const manage = !cfg || cfg.httpManageProcess !== false;
  if (!cfg || cfg.httpEnabled !== true) return { config: off, requireToken, manage };

  const rawHost = cfg.httpHost === undefined ? DEFAULT_HTTP_HOST : cfg.httpHost;
  const host = typeof rawHost === 'string' ? rawHost.trim() : '';
  if (!host || !isValidHttpHost(host)) {
    return { config: off, requireToken, manage, error: 'Invalid bind address ' + JSON.stringify(rawHost) + ' — use an IP address or hostname.' };
  }
  const port = cfg.httpPort === undefined ? DEFAULT_HTTP_PORT : cfg.httpPort;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { config: off, requireToken, manage, error: 'Invalid port ' + JSON.stringify(port) + ' — use a whole number from 1 to 65535.' };
  }
  const hosts = parseSettingList(cfg.httpAllowedHosts, normalizeAllowedHost, (e) =>
    'Invalid allowed host ' + JSON.stringify(e) + ' — use a hostname or IP, optionally with :port (IPv6 in [brackets]).');
  if (hosts.error) return { config: off, requireToken, manage, error: hosts.error };
  const origins = parseSettingList(cfg.httpAllowedOrigins, normalizeAllowedOrigin, (e) =>
    'Invalid allowed origin ' + JSON.stringify(e) + ' — use a full origin such as http://console.example.org (no path).');
  if (origins.error) return { config: off, requireToken, manage, error: origins.error };

  return {
    config: { enabled: true, host, port, allowedHosts: hosts.list, allowedOrigins: origins.list },
    requireToken,
    manage,
  };
}

// ---- files shared with the server and the pane ----------------------------

// Write-then-rename so a reader never sees a half-written file. Owner-only.
async function writeDataFile(name, text) {
  const result = await PluginAPI.executeNodeScript({
    script: `
      const fs = require('fs');
      const path = require('path');
      const target = path.join(path.dirname(args[0]), args[1]);
      const tmp = target + '.' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.tmp';
      fs.writeFileSync(tmp, args[2], { mode: 0o600 });
      fs.renameSync(tmp, target);
      return { success: true };
    `,
    args: [commandDir, name, text],
    timeout: 5000,
  });
  assertNodeResult(result, 'write ' + name);
}

// ---- bearer token ---------------------------------------------------------

async function generateToken() {
  const result = await PluginAPI.executeNodeScript({
    script: `return { success: true, token: require('crypto').randomBytes(32).toString('hex') };`,
    args: [],
    timeout: 5000,
  });
  return assertNodeResult(result, 'generate token').token;
}

// The token lives in SP's local-only secret store; created on first need (009-FR-012).
async function ensureToken() {
  if (cachedToken) return { token: cachedToken, created: false };
  if (typeof PluginAPI.getSecret !== 'function' || typeof PluginAPI.setSecret !== 'function') {
    throw new Error('this Super Productivity version has no secret storage');
  }
  let token = await PluginAPI.getSecret(TOKEN_SECRET_KEY);
  let created = false;
  if (!token || !TOKEN_RE.test(token)) {
    token = await generateToken();
    await PluginAPI.setSecret(TOKEN_SECRET_KEY, token);
    created = true;
  }
  cachedToken = token;
  return { token, created };
}

async function rotateToken() {
  const token = await generateToken();
  await PluginAPI.setSecret(TOKEN_SECRET_KEY, token);
  cachedToken = token;
  await syncHttpConfig(); // republish now rather than at the next poll
}

// Shows the current token (and offers to replace it). Reached from the server dialog and
// automatically the first time a token is created, since otherwise nobody would see it.
async function showTokenDialog() {
  if (typeof PluginAPI.openDialog !== 'function') return;
  let token = cachedToken;
  if (!token && typeof PluginAPI.getSecret === 'function') {
    try { token = await PluginAPI.getSecret(TOKEN_SECRET_KEY); } catch (e) { token = null; }
  }
  const body = token
    ? '<p>Clients of the HTTP server must send this header:</p>' +
      '<p><code style="user-select:all;word-break:break-all">Authorization: Bearer ' + esc(token) + '</code></p>' +
      '<p>The token is kept on this device only; it is not synced or included in backups. ' +
      'You can see, copy or replace it any time in the ' + PANEL_NAME + ' panel. ' +
      'Generating a new one immediately locks out clients using the old one.</p>'
    : '<p>No token has been created yet.</p>' +
      '<p>One is generated the first time you enable the HTTP server with "Require bearer token" on.</p>';
  const buttons = token ? [{ label: BTN_CLOSE }, { label: BTN_ROTATE, color: 'warn' }] : [{ label: BTN_CLOSE }];
  const choice = await PluginAPI.openDialog({ title: 'MCP HTTP server token', htmlContent: body, buttons });
  if (choice === BTN_ROTATE) {
    await rotateToken();
    await showTokenDialog();
  }
}

// ---- the server process ---------------------------------------------------

// Content-addressed install of the embedded server into <dataDir>/server/ (009-FR-015). The bundle travels in
// small pieces because SP caps a script at 100KB; the final step verifies the hash before the
// file gets its real name, so a half-written or tampered file is never one we would run.
async function ensureServerBundle() {
  if (serverBundlePath) return serverBundlePath;
  if (!hasEmbeddedServer()) throw new Error('this build of the plugin has no embedded server');
  const name = 'sp-mcp-http-' + embeddedServer.sha256.slice(0, 12) + '.mjs';

  const located = assertNodeResult(await PluginAPI.executeNodeScript({
    script: `
      const fs = require('fs');
      const path = require('path');
      const file = path.join(path.dirname(args[0]), 'server', args[1]);
      return { success: true, file: file, exists: fs.existsSync(file) };
    `,
    args: [commandDir, name],
    timeout: 5000,
  }), 'locate server');

  if (!located.exists) {
    const upload = (op, chunk) =>
      PluginAPI.executeNodeScript({
        script: `
          const fs = require('fs');
          const path = require('path');
          const dir = path.join(path.dirname(args[0]), 'server');
          const tmp = path.join(dir, args[1] + '.b64.tmp');
          if (args[2] === 'start') {
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            fs.writeFileSync(tmp, '', { mode: 0o600 });
          } else {
            fs.appendFileSync(tmp, args[3], 'utf-8');
          }
          return { success: true };
        `,
        args: [commandDir, name, op, chunk || ''],
        timeout: 5000,
      }).then((r) => { assertNodeResult(r, 'install server ' + op); });
    await upload('start');
    const b64 = embeddedServer.gzB64;
    for (let i = 0; i < b64.length; i += UPLOAD_CHUNK) await upload('append', b64.slice(i, i + UPLOAD_CHUNK));
    assertNodeResult(await PluginAPI.executeNodeScript({
      script: `
        const fs = require('fs');
        const path = require('path');
        const zlib = require('zlib');
        const crypto = require('crypto');
        const dir = path.join(path.dirname(args[0]), 'server');
        const tmp = path.join(dir, args[1] + '.b64.tmp');
        const out = path.join(dir, args[1]);
        let bundle;
        try {
          bundle = zlib.gunzipSync(Buffer.from(fs.readFileSync(tmp, 'utf-8'), 'base64'));
        } catch (e) {
          try { fs.unlinkSync(tmp); } catch (e2) {}
          return { success: false, error: 'embedded server is corrupt: ' + e.message };
        }
        const sum = crypto.createHash('sha256').update(bundle).digest('hex');
        if (sum !== args[2]) {
          try { fs.unlinkSync(tmp); } catch (e) {}
          return { success: false, error: 'embedded server failed its integrity check' };
        }
        fs.writeFileSync(out + '.tmp', bundle, { mode: 0o600 });
        fs.renameSync(out + '.tmp', out);
        fs.unlinkSync(tmp);
        for (const f of fs.readdirSync(dir)) {
          if (/^sp-mcp-http-[0-9a-f]+\.mjs$/.test(f) && f !== args[1]) {
            try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
          }
        }
        return { success: true };
      `,
      args: [commandDir, name, embeddedServer.sha256],
      timeout: 20000,
    }), 'install server');
  }
  serverBundlePath = located.file;
  return serverBundlePath;
}

// Status as the server last wrote it, plus whether that is believable (009-FR-016). "Alive" is the heartbeat,
// not a pid probe: a pid can be reused by something unrelated, a fresh heartbeat cannot.
async function readServerState() {
  const result = await PluginAPI.executeNodeScript({
    script: `
      const fs = require('fs');
      const path = require('path');
      try {
        return { success: true, status: JSON.parse(fs.readFileSync(path.join(path.dirname(args[0]), args[1]), 'utf-8')) };
      } catch (e) {
        return { success: true, status: null };
      }
    `,
    args: [commandDir, HTTP_STATUS_FILENAME],
    timeout: 5000,
  });
  const r = unwrapNodeResult(result);
  const status = r && r.success && r.status && typeof r.status === 'object' ? r.status : null;
  // A server can only write a final "stopped" if it shuts down gracefully; where SIGTERM is a forced
  // termination (Windows), or after a SIGKILL, the file keeps saying "listening" with a fresh heartbeat. We
  // confirmed that process gone ourselves, so whatever it last wrote is history. A newer write under the same
  // pid (a reused pid, a new server) postdates our kill and is believed again.
  const goneAt = status ? stoppedPids.get(status.pid) : undefined;
  const stale = goneAt !== undefined && !(status.updatedAt > goneAt);
  const alive = !!status && !stale && status.state !== 'stopped' && typeof status.updatedAt === 'number' &&
    Date.now() - status.updatedAt < HEARTBEAT_FRESH_MS;
  return { status, alive, managed: alive && status.managed === true };
}

// Which process SP's node scripts are children of, i.e. SP itself. A managed server records the
// pid it follows; one that follows someone else is a leftover from an earlier SP session.
async function getSpPid() {
  if (spMainPid !== undefined) return spMainPid;
  try {
    const r = assertNodeResult(await PluginAPI.executeNodeScript({
      script: `const process = require('process'); return { success: true, ppid: process.ppid };`,
      args: [],
      timeout: 5000,
    }), 'find SP pid');
    spMainPid = typeof r.ppid === 'number' ? r.ppid : null;
  } catch (e) {
    spMainPid = null;
  }
  return spMainPid;
}

async function killServer(pid) {
  if (typeof pid !== 'number') return;
  assertNodeResult(await PluginAPI.executeNodeScript({
    // Only ever called with the pid of a server whose fresh heartbeat says it is ours.
    script: `
      const process = require('process');
      const pid = args[0];
      if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return { success: false, error: 'refusing to signal pid ' + pid };
      try { process.kill(pid, 'SIGTERM'); } catch (e) {
        if (e.code === 'ESRCH') return { success: true, gone: true };
        throw e;
      }
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 200));
        try { process.kill(pid, 0); } catch (e) { return { success: true }; }
      }
      try { process.kill(pid, 'SIGKILL'); } catch (e) {}
      return { success: true, forced: true };
    `,
    args: [pid],
    timeout: 15000,
  }), 'stop server');
}

// Launch the embedded server detached (009-FR-014), at most MAX_LAUNCHES times per window (009-FR-018).
function launchServer() {
  return serial(async () => {
    const now = Date.now();
    recentLaunches = recentLaunches.filter((t) => now - t < LAUNCH_WINDOW_MS);
    if (recentLaunches.length >= MAX_LAUNCHES) {
      launchBlocked = true;
      PluginAPI.showSnack({
        msg: 'The MCP HTTP server keeps stopping, so Super Productivity has stopped relaunching it. ' +
          'See ' + dataDirOf() + '/' + HTTP_LOG_FILENAME + ', then press "Start" in the ' + PANEL_NAME + ' panel.',
        type: 'ERROR',
      });
      return false;
    }
    let bundle;
    try {
      bundle = await ensureServerBundle();
    } catch (e) {
      launchBlocked = true;
      PluginAPI.showSnack({ msg: 'Could not install the MCP HTTP server: ' + ((e && e.message) || e), type: 'ERROR' });
      return false;
    }
    const r = assertNodeResult(await PluginAPI.executeNodeScript({
      script: `
        const fs = require('fs');
        const path = require('path');
        const cp = require('child_process');
        const bundle = args[0];
        const dataDir = args[1];
        const logFile = path.join(dataDir, args[2]);
        let flag = 'a';
        try { if (fs.statSync(logFile).size > 524288) flag = 'w'; } catch (e) {}
        const out = fs.openSync(logFile, flag, 0o600);
        const env = { ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', SP_MCP_DATA_DIR: dataDir };
        if (process.platform === 'win32') env.SystemRoot = process.env.SystemRoot || 'C:\\\\Windows';
        const child = cp.spawn(process.execPath, ['--no-warnings', bundle, '--http', '--parent-pid', String(process.ppid)], {
          detached: true,
          stdio: ['ignore', out, out],
          windowsHide: true,
          env: env,
        });
        child.on('error', () => {});
        child.unref();
        fs.closeSync(out);
        return { success: true, pid: child.pid, parentPid: process.ppid };
      `,
      args: [bundle, dataDirOf(), HTTP_LOG_FILENAME],
      timeout: 10000,
    }), 'start server');
    lastLaunchAt = now;
    recentLaunches.push(now);
    weMayHaveServer = true;
    if (spMainPid === undefined && typeof r.parentPid === 'number') spMainPid = r.parentPid;
    return true;
  });
}

function stopServerProcess(srv) {
  return serial(async () => {
    if (!srv.managed) return;
    await killServer(srv.status.pid);
    const now = Date.now();
    stoppedPids.set(srv.status.pid, now);
    for (const [pid, at] of stoppedPids) if (now - at > 5 * 60 * 1000) stoppedPids.delete(pid);
    lastLaunchAt = 0; // what we launched is gone, so there is nothing left to wait for before the next launch
  });
}

// What to do about the process on every poll (009-FR-014, 009-FR-016 … 009-FR-018). Settings are already published by now, so a fresh
// server starts with them; later settings changes reach it through the file, no restart needed.
async function reconcileProcess(config, srv) {
  if (!config.enabled) {
    userStopped = false;
    launchBlocked = false;
    externalNoticeShown = false;
    if (srv.managed) {
      await stopServerProcess(srv);
      weMayHaveServer = false;
    } else if (!srv.alive && Date.now() - lastLaunchAt >= LAUNCH_GRACE_MS) {
      weMayHaveServer = false; // nothing there, and nothing still starting up
    }
    return;
  }
  if (userStopped || launchBlocked) return;
  if (srv.alive && !srv.managed) {
    if (!externalNoticeShown) {
      externalNoticeShown = true;
      PluginAPI.showSnack({
        msg: 'An MCP HTTP server is already running outside Super Productivity (pid ' + srv.status.pid + '), so none was started. ' +
          'It follows these settings; Super Productivity cannot restart it.',
        type: 'INFO',
      });
    }
    return;
  }
  if (srv.managed) {
    weMayHaveServer = true;
    const sp = await getSpPid();
    if (sp === null || srv.status.parentPid === sp) return; // running, and ours
    await stopServerProcess(srv);                           // a leftover from an earlier SP session
  } else if (Date.now() - lastLaunchAt < LAUNCH_GRACE_MS) {
    return;                                                 // launched moments ago; give it time to report in
  }
  await launchServer();
}

// A bind failure only the server can see (009-FR-020). Reported once, and only after it has stopped trying.
async function reportBindFailure(config, status) {
  if (!status || status.state !== 'bind-failed' || !status.error) return;
  if (status.host !== config.host || status.port !== config.port) return;
  if (typeof status.updatedAt === 'number' && status.updatedAt < lastLaunchAt) return; // from before our latest (re)launch
  const key = lastPublishedHttpConfig + '|' + status.error;
  if (key === lastStatusToastKey) return;
  lastStatusToastKey = key;
  const controlled = currentHttp && currentHttp.manage && hasEmbeddedServer();
  PluginAPI.showSnack({
    msg: 'MCP HTTP server could not listen on ' + config.host + ':' + config.port + ' after ' + (status.maxAttempts || status.attempt || 3) +
      ' attempts — ' + status.error + '. It has stopped trying. Free the port or pick another in the plugin settings, then ' +
      (controlled ? 'press "Restart" in the ' + PANEL_NAME + ' panel.' : 'restart the server yourself.'),
    type: 'ERROR',
  });
}

function resetLaunchState() {
  launchBlocked = false;
  recentLaunches = [];
  lastLaunchAt = 0;
  lastStatusToastKey = null;
  externalNoticeShown = false;
}

// ---- actions behind the pane's buttons -------------------------------------

function canControl() {
  if (!currentHttp || !currentHttp.config.enabled) {
    PluginAPI.showSnack({ msg: 'Enable the HTTP server in the plugin settings first.', type: 'WARNING' });
    return false;
  }
  if (!currentHttp.manage || !hasEmbeddedServer()) {
    PluginAPI.showSnack({
      msg: 'The server runs outside Super Productivity, so it cannot be controlled from here. ' +
        'Restart it yourself, or switch the HTTP option off and on again in the plugin settings to make it retry binding.',
      type: 'INFO',
    });
    return false;
  }
  return true;
}

async function restartServer() {
  if (!canControl()) return;
  userStopped = false;
  resetLaunchState();
  const srv = await readServerState();
  if (srv.alive && !srv.managed) { await reconcileProcess(currentHttp.config, srv); return; }
  if (srv.managed) await stopServerProcess(srv);
  if (await launchServer()) PluginAPI.showSnack({ msg: 'Restarting the MCP HTTP server…', type: 'INFO' });
}

async function startServerByUser() {
  if (!canControl()) return;
  userStopped = false;
  resetLaunchState();
  const srv = await readServerState();
  if (srv.alive) { await reconcileProcess(currentHttp.config, srv); return; }
  if (await launchServer()) PluginAPI.showSnack({ msg: 'Starting the MCP HTTP server…', type: 'INFO' });
}

async function stopServerByUser() {
  if (!canControl()) return;
  userStopped = true; // sticks until the user starts it again or switches HTTP off and on
  const srv = await readServerState();
  if (srv.managed) await stopServerProcess(srv);
  PluginAPI.showSnack({ msg: 'Stopped the MCP HTTP server.', type: 'INFO' });
}

// Plugin unload (disabled, replaced, SP shutting down): don't leave our server behind.
async function stopManagedServer() {
  if (!commandDir) return;
  const srv = await readServerState();
  if (srv.managed) await stopServerProcess(srv);
}

// What the pane shows (009-FR-019, 009-FR-022). Plain text (the pane uses textContent, so nothing here is escaped) and no
// secrets: the token is only described, never included. `controls` says which buttons make sense.
function buildPanelModel(cur, srv) {
  const st = srv.status || {};
  const bind = st.host && st.port ? st.host + ':' + st.port : '';
  const none = { restart: false, stop: false, start: false };
  const out = {
    tone: 'idle', headline: '', detail: '', url: null, pid: null, controls: none,
    token: { required: !!cur.requireToken, present: !!cur.tokenPublished },
    ack: controlAck,
  };

  if (!cur.config.enabled) {
    out.headline = 'Off';
    out.detail = 'The HTTP server is switched off in the plugin settings.';
    return out;
  }
  if (srv.alive && !srv.managed) {
    out.tone = st.state === 'listening' ? 'ok' : 'warn';
    out.headline = 'Running outside Super Productivity';
    out.detail = 'Started by hand or by another tool (pid ' + st.pid + '); it follows the plugin settings, ' +
      'but Super Productivity cannot restart it.' + (st.state === 'listening' ? ' Listening on http://' + bind + '/mcp.' : '');
    out.url = st.state === 'listening' ? 'http://' + bind + '/mcp' : null;
    out.pid = st.pid;
    return out;
  }
  if (srv.managed) {
    out.pid = st.pid;
    out.controls = { restart: true, stop: true, start: false };
    const owner = 'Started and managed by Super Productivity (pid ' + st.pid + ').';
    if (st.state === 'listening') {
      out.tone = 'ok';
      out.url = 'http://' + bind + '/mcp';
      out.headline = 'Listening on ' + out.url;
      out.detail = owner;
    } else if (st.state === 'retrying') {
      out.tone = 'warn';
      out.headline = 'Port busy — retrying';
      out.detail = 'Attempt ' + st.attempt + ' of ' + st.maxAttempts + ' on ' + bind + ': ' + st.error + '. ' + owner;
    } else if (st.state === 'bind-failed') {
      out.tone = 'error';
      out.headline = 'Could not listen on ' + bind;
      out.detail = 'Gave up after ' + (st.maxAttempts || st.attempt) + ' attempts: ' + st.error +
        '. Free the port or change it in the settings, then restart. ' + owner;
    } else if (st.state === 'invalid-config') {
      out.tone = 'error';
      out.headline = 'The server rejected its settings';
      out.detail = String(st.error) + ' ' + owner;
    } else {
      out.tone = 'warn';
      out.headline = 'Running, but not listening';
      out.detail = 'State: ' + st.state + '. ' + owner;
    }
    return out;
  }
  if (!hasEmbeddedServer() && cur.manage) {
    out.headline = 'Not running';
    out.detail = 'This build of the plugin has no embedded server. Run "super-productivity-mcp --http" yourself.';
    return out;
  }
  if (!cur.manage) {
    out.headline = 'Not running';
    out.detail = 'Process management is switched off, so run "super-productivity-mcp --http" yourself.';
    return out;
  }
  if (userStopped) {
    out.headline = 'Stopped';
    out.detail = 'You stopped it. It stays stopped until you start it again.';
    out.controls = { restart: false, stop: false, start: true };
    return out;
  }
  if (launchBlocked) {
    out.tone = 'error';
    out.headline = 'Keeps stopping';
    out.detail = 'It is no longer being relaunched. See ' + dataDirOf() + '/' + HTTP_LOG_FILENAME + ', then start it again.';
    out.controls = { restart: false, stop: false, start: true };
    return out;
  }
  if (Date.now() - lastLaunchAt < LAUNCH_GRACE_MS) {
    out.tone = 'warn';
    out.headline = 'Starting…';
    out.detail = 'The server was just launched.';
    return out; // no controls: a second launch now would race the first
  }
  out.headline = 'Not running';
  out.detail = 'It will be started shortly.';
  out.controls = { restart: false, stop: false, start: true };
  return out;
}

// Publish the panel model for the pane. Only when it changes, plus a heartbeat so a pane that sees
// an old updatedAt knows the plugin itself has stopped.
async function publishPanel(srv) {
  if (!currentHttp) return;
  const model = buildPanelModel(currentHttp, srv);
  const body = JSON.stringify(model);
  const now = Date.now();
  if (body === lastPanelBody && now - lastPanelAt < PANEL_HEARTBEAT_MS) return;
  await writeDataFile(HTTP_PANEL_FILENAME, JSON.stringify(Object.assign({ version: 1, updatedAt: now }, model)));
  lastPanelBody = body;
  lastPanelAt = now;
}

// The pane asks for things by dropping a request file (009-FR-022): its iframe can't reach plugin.js directly
// or read secrets. Consumed on read; an id is acted on once; anything malformed is discarded.
async function takeControlRequest() {
  const result = await PluginAPI.executeNodeScript({
    script: `
      const fs = require('fs');
      const path = require('path');
      const file = path.join(path.dirname(args[0]), args[1]);
      let text = null;
      try { text = fs.readFileSync(file, 'utf-8'); } catch (e) { return { success: true, text: null }; }
      try { fs.unlinkSync(file); } catch (e) {}
      return { success: true, text: text };
    `,
    args: [commandDir, HTTP_CONTROL_FILENAME],
    timeout: 5000,
  });
  const r = unwrapNodeResult(result);
  if (!r || !r.success || typeof r.text !== 'string') return null;
  let req;
  try { req = JSON.parse(r.text); } catch (e) { return null; }
  if (!req || typeof req !== 'object' || typeof req.id !== 'string' || !req.id || req.id.length > 64) return null;
  return req;
}

async function handleControlRequest() {
  const req = await takeControlRequest();
  if (!req || req.id === lastControlId) return;
  lastControlId = req.id;
  try {
    if (req.action === 'restart') await restartServer();
    else if (req.action === 'stop') await stopServerByUser();
    else if (req.action === 'start') await startServerByUser();
    else if (req.action === 'rotate-token') {
      if (currentHttp && currentHttp.requireToken) await rotateToken();
      else PluginAPI.showSnack({ msg: 'Switch on "Require bearer token" in the plugin settings first.', type: 'INFO' });
    }
  } catch (e) {
    console.error('Control request failed:', e && e.message ? e.message : e);
    PluginAPI.showSnack({ msg: 'That did not work: ' + ((e && e.message) || e), type: 'ERROR' });
  }
  controlAck = req.id; // even for an unknown action, so the pane stops waiting
}

// ---- the poll -------------------------------------------------------------

// Called from the poll loop. Cheap when nothing changed: one settings read and a string compare
// (plus one status read while the server is, or may be, running). Never throws — a settings
// hiccup must not stall command polling.
async function syncHttpConfig() {
  if (!commandDir || httpSyncInFlight) return;
  httpSyncInFlight = true;
  try {
    // Requests from the pane first, so what they change (e.g. a new token) is published in this same pass.
    await handleControlRequest();
    const normalized = normalizeHttpSettings(await PluginAPI.loadSyncedData());
    let config = normalized.config;
    let error = normalized.error;
    let token = null;
    let tokenCreated = false;

    if (config.enabled && normalized.requireToken) {
      try {
        const t = await ensureToken();
        token = t.token;
        tokenCreated = t.created;
      } catch (e) {
        // Fail closed: "token required" must never silently become "no token".
        config = offHttpConfig();
        error = 'Could not get a bearer token (' + ((e && e.message) || e) + '). ' +
          'Update Super Productivity, or switch off "Require bearer token".';
      }
    }

    if (error && error !== lastHttpConfigError) {
      PluginAPI.showSnack({ msg: 'MCP HTTP server stays off: ' + error, type: 'ERROR' });
    }
    lastHttpConfigError = error || null;

    const managed = normalized.manage && hasEmbeddedServer();
    if (normalized.manage && config.enabled && !hasEmbeddedServer()) {
      console.warn('This plugin build has no embedded MCP server; run "super-productivity-mcp --http" yourself.');
    }

    const payload = JSON.stringify(token ? Object.assign({}, config, { token }) : config);
    if (payload !== lastPublishedHttpConfig) {
      await writeDataFile(HTTP_CONFIG_FILENAME, payload);

      const previous = lastPublishedHttpConfig === null ? null : JSON.parse(lastPublishedHttpConfig);
      lastPublishedHttpConfig = payload;
      // Any settings change is a fresh start for relaunch attempts; switching on also clears a manual Stop.
      if (previous) {
        launchBlocked = false;
        recentLaunches = [];
        lastStatusToastKey = null;
        if (config.enabled && !previous.enabled) userStopped = false;
      }
      // Only announce a user-driven switch-on, not the state we find at startup.
      if (config.enabled && previous && !previous.enabled && !managed) {
        PluginAPI.showSnack({
          msg: 'MCP HTTP enabled for ' + config.host + ':' + config.port + '. Run "super-productivity-mcp --http" to serve it.',
          type: 'INFO',
        });
      }
      if (config.enabled && !token && !isLoopbackBind(config.host)) {
        PluginAPI.showSnack({
          msg: 'The MCP HTTP server is open to your network without a bearer token: anyone who can reach ' + config.host + ':' + config.port +
            ' can read and change your tasks. Requiring a token is best practice — switch on "Require bearer token" in the plugin settings.',
          type: 'WARNING',
        });
      }
    }
    currentHttp = { config, manage: normalized.manage, requireToken: normalized.requireToken, tokenPublished: token !== null };
    if (tokenCreated) void showTokenDialog().catch((e) => { console.error('Token dialog failed:', e); });

    let srv = { status: null, alive: false, managed: false };
    if (config.enabled || weMayHaveServer) {
      srv = await readServerState();
      if (config.enabled) await reportBindFailure(config, srv.status);
      if (managed) await reconcileProcess(config, srv);
    }
    await publishPanel(srv);
  } catch (e) {
    console.error('syncHttpConfig failed:', e && e.message ? e.message : e);
  } finally {
    httpSyncInFlight = false;
  }
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
      case 'logTimeEntries': {
        // PluginAPI has no addTimeSpent equivalent, and updateTask() silently no-ops on
        // an unknown id (the quirk bulkUpdateTasks and startTask guard against), so the
        // task has to be looked up before anything is written.
        const logData = command.data || {};
        const logEntries = logData.entries;
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
          const archivedError = await archivedTaskError(command.taskId);
          return {
            success: false,
            error: archivedError || `Task not found: ${command.taskId}`,
            timestamp: Date.now(),
          };
        }
        await PluginAPI.deleteTask(command.taskId);
        result = null;
        break;
      }
      case 'deleteProject': {
        // The Inbox is a fixed, well-known project (id 'INBOX_PROJECT') that
        // PluginAPI.deleteProject itself refuses to remove — checking for it here
        // first means the caller gets a precise, named error instead of depending
        // on the exact wording of whatever refusal the host throws.
        if (command.projectId === 'INBOX_PROJECT') {
          return {
            success: false,
            error: 'The Inbox project cannot be deleted.',
            timestamp: Date.now(),
          };
        }
        const allProjectsForDelete = await PluginAPI.getAllProjects();
        const projectToDelete = allProjectsForDelete.find(p => p.id === command.projectId);
        if (!projectToDelete) {
          return {
            success: false,
            error: `Project not found: ${command.projectId}`,
            timestamp: Date.now(),
          };
        }
        await PluginAPI.deleteProject(command.projectId);
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
  void syncHttpConfig();
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
  if (typeof PluginAPI.onUnload === 'function') {
    PluginAPI.onUnload(async () => {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      try { await stopManagedServer(); } catch (e) { console.error('Stopping the MCP HTTP server failed:', e); }
    });
  }
  await syncHttpConfig();
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
