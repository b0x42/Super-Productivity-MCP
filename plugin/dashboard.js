// Tool call timeline — the plugin's iframe pane.
//
// SP injects a filtered PluginAPI into index.html and proxies executeNodeScript
// through the host bridge whenever nodeExecution is granted, so this reads the
// log the MCP server writes without any postMessage bridge back to plugin.js.

var REFRESH_MS = 2000;
var LOG_FILENAME = 'tool-calls.jsonl';

// ---------------------------------------------------------------- pure helpers

/**
 * Parse the JSONL log into entries, newest first. A half-written final line is
 * expected — the server appends while the pane reads — so unparseable lines are
 * skipped rather than failing the render.
 */
function parseLog(text) {
  if (!text || typeof text !== 'string') return [];
  var entries = [];
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    try {
      var parsed = JSON.parse(line);
      // Guard against valid JSON that isn't an entry ("null", "42").
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) entries.push(parsed);
    } catch (e) { /* partial or corrupt line — skip it */ }
  }
  return entries.reverse();
}

function formatDuration(ms) {
  if (typeof ms !== 'number' || isNaN(ms)) return '—';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return Math.floor(ms / 60000) + 'm ' + Math.round((ms % 60000) / 1000) + 's';
}

/**
 * Identity of an entry across refreshes. Position can't be used — new entries
 * arrive above older ones — so identity comes from the entry's own fields.
 * `seq` (a per-process write counter the recorder stamps on each entry)
 * disambiguates two calls to the same tool finishing in the same millisecond;
 * older log lines written before `seq` existed fall back to ts + tool.
 */
function entryKey(entry) {
  var seq = entry && entry.seq;
  if (typeof seq === 'number') return (entry.ts) + '|' + (entry.tool) + '|' + seq;
  return (entry && entry.ts) + '|' + (entry && entry.tool);
}

/** Whether the log actually changed since the last poll. */
function hasChanged(previous, next) {
  return previous !== next;
}

function formatTime(ts) {
  if (typeof ts !== 'number' || isNaN(ts)) return '—';
  var d = new Date(ts);
  var pad = function (n) { return String(n).padStart(2, '0'); };
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

// ---------------------------------------------------------------- server panel (pure)

// The panel above the tool calls shows the HTTP server and lets you manage it (009-FR-019,
// 009-FR-021, 009-FR-022). This iframe can't reach plugin.js or read secrets, so the plugin
// publishes a ready-made, plain-text description (http_panel.json) and we hand it requests by
// dropping a file (http_control.json). Everything the panel does is decided here, in pure
// functions; the DOM code below only draws panelView()'s answer.

var PANEL_FILENAME = 'http_panel.json';
var CONTROL_FILENAME = 'http_control.json';
var CONFIG_FILENAME = 'http_config.json';
/** The plugin rewrites the panel at least every 10s; silence for this long means it has stopped. */
var PANEL_STALE_MS = 30000;
/** How long a button stays disabled waiting for the plugin to acknowledge a request. */
var PENDING_TIMEOUT_MS = 20000;
var TONES = ['ok', 'warn', 'error', 'idle'];
var ACTIONS = ['restart', 'stop', 'start', 'rotate-token'];
var PENDING_LABELS = { restart: 'Restarting…', stop: 'Stopping…', start: 'Starting…', 'rotate-token': 'Replacing…' };
var BUTTON_LABELS = { restart: 'Restart', stop: 'Stop', start: 'Start' };

function str(v) { return typeof v === 'string' ? v : ''; }

/** Parse the plugin's panel file. It is a file on disk, so nothing in it is trusted to have the right shape. */
function parsePanel(text) {
  if (!text || typeof text !== 'string') return null;
  var m;
  try { m = JSON.parse(text); } catch (e) { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.version !== 1) return null;
  if (typeof m.updatedAt !== 'number') return null; // without a timestamp there is no telling whether it is current
  var c = m.controls && typeof m.controls === 'object' ? m.controls : {};
  var t = m.token && typeof m.token === 'object' ? m.token : {};
  return {
    updatedAt: m.updatedAt,
    tone: TONES.indexOf(m.tone) !== -1 ? m.tone : 'idle',
    headline: str(m.headline),
    detail: str(m.detail),
    url: typeof m.url === 'string' ? m.url : null,
    pid: typeof m.pid === 'number' ? m.pid : null,
    controls: { restart: c.restart === true, stop: c.stop === true, start: c.start === true },
    token: { required: t.required === true, present: t.present === true },
    ack: typeof m.ack === 'string' ? m.ack : null,
  };
}

/** Same for every token, so the mask doesn't give away how long it is. */
function maskToken() { return '••••••••••••••••'; }

/** The token the plugin published in http_config.json, or null if there isn't a usable one. */
function tokenFromConfig(text) {
  if (!text || typeof text !== 'string') return null;
  var cfg;
  try { cfg = JSON.parse(text); } catch (e) { return null; }
  var t = cfg && cfg.token;
  return typeof t === 'string' && /^[\x21-\x7e]{16,256}$/.test(t) ? t : null;
}

/** A request for the plugin. The id lets it act once and lets us recognise its acknowledgement. */
function makeControlRequest(action, now) {
  if (ACTIONS.indexOf(action) === -1) throw new Error('Unknown action: ' + action);
  var rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  return { id: 'c' + now.toString(36) + rand, action: action, at: now };
}

/**
 * Everything the panel draws, as data.
 * state: { now, pending: {id, action, since}|null, revealed, token, confirmRotate }
 */
function panelView(model, state) {
  if (!model) return { visible: false };
  var now = state.now;
  var stale = now - model.updatedAt > PANEL_STALE_MS;
  var pending = !!state.pending && model.ack !== state.pending.id && now - state.pending.since <= PENDING_TIMEOUT_MS;
  var pendingAction = pending ? state.pending.action : null;

  var buttons = [];
  ['restart', 'stop', 'start'].forEach(function (id) {
    if (!model.controls[id]) return;
    buttons.push({
      id: id,
      label: pendingAction === id ? PENDING_LABELS[id] : BUTTON_LABELS[id],
      disabled: stale || pending,
    });
  });

  var tok = { visible: model.token.required };
  if (tok.visible) {
    var have = model.token.present;
    var shown = !!state.revealed && !!state.token;
    tok.canReveal = have;
    tok.canRotate = have && !stale && !pending;
    tok.hint = have ? '' : 'A token is created when the server starts.';
    tok.text = shown ? state.token : maskToken();
    tok.revealLabel = shown ? 'Hide' : 'Show';
    tok.rotateLabel = pendingAction === 'rotate-token'
      ? PENDING_LABELS['rotate-token']
      : state.confirmRotate ? 'Really replace? Clients using the current token are locked out' : 'New token';
  }

  return {
    visible: true,
    tone: model.tone,
    headline: model.headline,
    detail: stale ? 'The plugin has not reported for a while, so this may be out of date. ' + model.detail : model.detail,
    url: model.url,
    stale: stale,
    pending: pending,
    buttons: buttons,
    token: tok,
  };
}

// ---------------------------------------------------------------- reading and writing files

// Finds the data dir the same way plugin.js does, including an SP_MCP_DATA_DIR override recorded in
// mcp_config.json — otherwise a redirected data dir makes the pane show nothing while the server
// writes elsewhere. pickDir() answers "which dir holds one of these files"; the pane never creates
// directories or decides where the IPC dir goes. Keep these scripts to fs/path/os and avoid SP's
// "real process" trigger words: SP runs such scripts in a sandbox, and anything else spawns a process.
var DATA_DIR_SCRIPT = [
  "const fs = require('fs');",
  "const path = require('path');",
  "const os = require('os');",
  "const home = os.homedir();",
  "const APP = 'super-productivity-mcp';",
  "const TMP_ROOT = '/tmp';",
  "let candidates;",
  "if (os.platform() === 'darwin') {",
  "  candidates = [",
  "    path.join(home, 'Library', 'Containers', 'com.super-productivity.app', 'Data', 'Library', 'Application Support', APP),",
  "    path.join(home, 'Library', 'Application Support', APP)",
  "  ];",
  "} else if (os.platform() === 'win32') {",
  "  const appData = (typeof process !== 'undefined' && process.env && process.env.APPDATA) || path.join(home, 'AppData', 'Roaming');",
  "  candidates = [path.join(appData, APP)];",
  "} else {",
  "  const xdgData = (typeof process !== 'undefined' && process.env && process.env.XDG_DATA_HOME) || path.join(home, '.local', 'share');",
  "  candidates = [",
  "    path.join(home, '.var', 'app', 'com.super_productivity.SuperProductivity', 'data', APP),",
  "    path.join(home, '.var', 'app', 'com.super_productivity.SuperProductivity', 'config', APP),",
  "    path.join(xdgData, APP),",
  "    path.join(home, 'snap', 'superproductivity', 'common', '.local', 'share', APP),",
  "    path.join(home, 'snap', 'superproductivity', 'current', '.local', 'share', APP),",
  "    path.join('/tmp', APP)",
  "  ];",
  "}",
  "function isTmpDataDir(dir) { return dir === TMP_ROOT || dir.indexOf(TMP_ROOT + '/') === 0; }",
  "let dataDir = null;",
  "for (const dir of candidates) {",
  "  if (isTmpDataDir(dir)) continue;",
  "  try {",
  "    const cfg = path.join(dir, 'mcp_config.json');",
  "    if (fs.existsSync(cfg)) {",
  "      const c = JSON.parse(fs.readFileSync(cfg, 'utf-8'));",
  "      if (c.dataDir && fs.existsSync(c.dataDir) && !isTmpDataDir(c.dataDir)) { dataDir = c.dataDir; break; }",
  "    }",
  "  } catch (e) { /* ignore invalid or inaccessible config */ }",
  "}",
  "function pickDir(files) {",
  "  const dirs = dataDir ? [dataDir] : candidates;",
  "  for (const dir of dirs) {",
  "    for (const f of files) { if (fs.existsSync(path.join(dir, f))) return dir; }",
  "  }",
  "  return null;",
  "}",
].join('\n');

function readFileOrNull(name) {
  return "(function () { try { return fs.readFileSync(path.join(dir, '" + name + "'), 'utf-8'); } catch (e) { return null; } })()";
}

/** The tool-call log and the panel, from whichever data dir holds either. */
var READ_PANE_SCRIPT = DATA_DIR_SCRIPT + '\n' + [
  "const dir = pickDir(['" + PANEL_FILENAME + "', '" + LOG_FILENAME + "']);",
  "if (!dir) return { dir: null, log: null, panel: null };",
  "return { dir: dir, log: " + readFileOrNull(LOG_FILENAME) + ", panel: " + readFileOrNull(PANEL_FILENAME) + " };",
].join('\n');

/** Where the plugin is publishing is where it will look: write the request next to its panel file. */
var WRITE_CONTROL_SCRIPT = DATA_DIR_SCRIPT + '\n' + [
  "const dir = pickDir(['" + PANEL_FILENAME + "']);",
  "if (!dir) return { success: false, error: 'The plugin has not reported yet. Is it enabled, with Node access allowed?' };",
  "const target = path.join(dir, '" + CONTROL_FILENAME + "');",
  "const tmp = target + '.' + Date.now() + '.tmp';",
  "fs.writeFileSync(tmp, args[0], { mode: 0o600 });",
  "fs.renameSync(tmp, target);",
  "return { success: true };",
].join('\n');

/** The token lives in the owner-only config the plugin publishes; the secret store is out of this iframe's reach. */
var READ_TOKEN_SCRIPT = DATA_DIR_SCRIPT + '\n' + [
  "const dir = pickDir(['" + PANEL_FILENAME + "']);",
  "if (!dir) return { success: true, text: null };",
  "return { success: true, text: " + readFileOrNull(CONFIG_FILENAME) + " };",
].join('\n');

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseLog: parseLog, formatDuration: formatDuration, formatTime: formatTime,
    entryKey: entryKey, hasChanged: hasChanged,
    parsePanel: parsePanel, panelView: panelView, makeControlRequest: makeControlRequest,
    tokenFromConfig: tokenFromConfig, maskToken: maskToken,
    PANEL_STALE_MS: PANEL_STALE_MS, PENDING_TIMEOUT_MS: PENDING_TIMEOUT_MS,
    READ_PANE_SCRIPT: READ_PANE_SCRIPT, WRITE_CONTROL_SCRIPT: WRITE_CONTROL_SCRIPT, READ_TOKEN_SCRIPT: READ_TOKEN_SCRIPT,
  };
}

// ---------------------------------------------------------------- talking to the plugin

function unwrap(result) {
  return result && result.success && result.result && typeof result.result === 'object' ? result.result : result;
}

function needNode() {
  if (typeof PluginAPI === 'undefined' || typeof PluginAPI.executeNodeScript !== 'function') {
    throw new Error('This pane needs Node execution. Enable it for the plugin in Super Productivity settings.');
  }
}

/** The log and the panel in one round trip. */
async function readPane() {
  needNode();
  var res = unwrap(await PluginAPI.executeNodeScript({ script: READ_PANE_SCRIPT, timeout: 5000 }));
  if (!res || res.success === false) throw new Error((res && res.error) || 'Could not read the log');
  return { log: typeof res.log === 'string' ? res.log : '', panel: typeof res.panel === 'string' ? res.panel : null };
}

async function sendControl(request) {
  needNode();
  var res = unwrap(await PluginAPI.executeNodeScript({ script: WRITE_CONTROL_SCRIPT, args: [JSON.stringify(request)], timeout: 5000 }));
  if (!res || res.success === false) throw new Error((res && res.error) || 'Could not send the request');
}

async function readToken() {
  needNode();
  var res = unwrap(await PluginAPI.executeNodeScript({ script: READ_TOKEN_SCRIPT, timeout: 5000 }));
  return res && res.success !== false ? tokenFromConfig(res.text) : null;
}

// ---------------------------------------------------------------- rendering

function statusOf(entry) {
  return entry.ok === false ? 'err' : 'ok';
}

function payloadText(value) {
  if (value === undefined) return null;
  if (value && value._truncated) {
    // Be honest that this isn't the whole thing rather than showing a clipped
    // object as if it were complete.
    return '// truncated — ' + value.bytes + ' bytes not recorded\n' + (value.preview || '');
  }
  try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }
}

function renderEntry(entry, expanded) {
  var key = entryKey(entry);
  var row = document.createElement('div');
  row.className = 'entry ' + statusOf(entry);

  var head = document.createElement('button');
  head.className = 'head';
  head.setAttribute('aria-expanded', 'false');
  head.innerHTML =
    '<span class="time">' + formatTime(entry.ts) + '</span>' +
    '<span class="tool"></span>' +
    '<span class="dur">' + formatDuration(entry.ms) + '</span>' +
    '<span class="badge">' + (entry.ok === false ? 'error' : 'ok') + '</span>';
  // Tool names come from our own registry, but set as text regardless — the log
  // is a file on disk and nothing here should be able to inject markup.
  head.querySelector('.tool').textContent = entry.tool || '(unknown)';

  var body = document.createElement('div');
  body.className = 'body';
  body.hidden = !expanded.has(key);
  head.setAttribute('aria-expanded', String(!body.hidden));

  if (entry.error) {
    var err = document.createElement('p');
    err.className = 'err-msg';
    err.textContent = entry.error;
    body.appendChild(err);
  }
  [['arguments', entry.args], ['result', entry.result]].forEach(function (pair) {
    var text = payloadText(pair[1]);
    if (text === null) return;
    var h = document.createElement('h4');
    h.textContent = pair[0];
    var pre = document.createElement('pre');
    pre.textContent = text;
    body.appendChild(h);
    body.appendChild(pre);
  });

  head.addEventListener('click', function () {
    body.hidden = !body.hidden;
    head.setAttribute('aria-expanded', String(!body.hidden));
    if (body.hidden) expanded.delete(key); else expanded.add(key);
  });

  row.appendChild(head);
  row.appendChild(body);
  return row;
}

function render(entries, root, status, expanded) {
  root.textContent = '';
  if (!entries.length) {
    var empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No tool calls recorded yet. Ask your assistant to do something in Super Productivity.';
    root.appendChild(empty);
    status.textContent = '';
    return;
  }
  entries.forEach(function (entry) { root.appendChild(renderEntry(entry, expanded)); });
  var failed = entries.filter(function (e) { return e.ok === false; }).length;
  status.textContent = entries.length + ' call' + (entries.length === 1 ? '' : 's') +
    (failed ? ' · ' + failed + ' failed' : '');
}

// ---------------------------------------------------------------- server panel (DOM)

var panelState = {
  model: null,        // parsed http_panel.json, or null
  pending: null,      // { id, action, since } while we wait for the plugin to acknowledge a request
  revealed: false,    // token shown in clear
  token: null,
  confirmRotate: false,
  note: '',           // one-line feedback ("Token copied.", a failed request)
  lastDrawn: null,
  refreshNow: null,   // set at startup: re-read the plugin's state right away
  fast: null,         // timer that does so more often while a request is in flight
};

/** How often to re-read the plugin's state while waiting for it to acknowledge a request. */
var PENDING_REFRESH_MS = 500;

function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, onClick, disabled, extraClass) {
  var b = el('button', 'btn' + (extraClass ? ' ' + extraClass : ''), label);
  b.type = 'button';
  b.disabled = !!disabled;
  b.addEventListener('click', onClick);
  return b;
}

function setNote(root, text, ms) {
  panelState.note = text;
  drawPanel(root);
  if (ms) setTimeout(function () { if (panelState.note === text) { panelState.note = ''; drawPanel(root); } }, ms);
}

/**
 * The regular refresh is every 2s, which added up to a couple of seconds of "Stopping…" on top of the plugin
 * picking the request up. While one is in flight, look again twice a second; stop once it is acknowledged
 * (or has timed out), so an idle pane costs nothing extra.
 */
function watchPending() {
  if (panelState.fast) return;
  panelState.fast = setInterval(function () {
    var p = panelState.pending;
    if (!p || Date.now() - p.since > PENDING_TIMEOUT_MS) {
      clearInterval(panelState.fast);
      panelState.fast = null;
      return;
    }
    if (panelState.refreshNow) panelState.refreshNow();
  }, PENDING_REFRESH_MS);
}

function sendAction(root, action) {
  var req = makeControlRequest(action, Date.now());
  panelState.pending = { id: req.id, action: action, since: Date.now() };
  panelState.note = '';
  drawPanel(root);
  watchPending();
  sendControl(req).catch(function (err) {
    panelState.pending = null;
    setNote(root, err.message || String(err));
  });
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) { /* the iframe may not be allowed to use the clipboard API */ }
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}

function toggleReveal(root) {
  if (panelState.revealed) {
    panelState.revealed = false;
    panelState.token = null;
    drawPanel(root);
    return;
  }
  readToken().then(function (t) {
    panelState.token = t;
    panelState.revealed = !!t;
    setNote(root, t ? '' : 'The token is not available yet.');
  }).catch(function (err) { setNote(root, err.message || String(err)); });
}

function copyToken(root) {
  readToken().then(function (t) {
    if (!t) { setNote(root, 'The token is not available yet.'); return; }
    return copyText(t).then(function (ok) {
      if (ok) { setNote(root, 'Token copied.', 3000); return; }
      panelState.token = t; // blocked here: show it so it can be selected by hand
      panelState.revealed = true;
      setNote(root, 'Copying is blocked here. Select the token above instead.');
    });
  }).catch(function (err) { setNote(root, err.message || String(err)); });
}

function rotateToken(root) {
  if (!panelState.confirmRotate) {
    panelState.confirmRotate = true;
    drawPanel(root);
    setTimeout(function () { if (panelState.confirmRotate) { panelState.confirmRotate = false; drawPanel(root); } }, 5000);
    return;
  }
  panelState.confirmRotate = false;
  panelState.token = null;
  sendAction(root, 'rotate-token');
}

function drawPanel(root) {
  var v = panelView(panelState.model, {
    now: Date.now(),
    pending: panelState.pending,
    revealed: panelState.revealed,
    token: panelState.token,
    confirmRotate: panelState.confirmRotate,
  });
  // Redrawing is what would drop a half-made selection or a focused button, so only do it on change.
  var key = JSON.stringify([v, panelState.note]);
  if (key === panelState.lastDrawn) return;
  panelState.lastDrawn = key;

  root.textContent = '';
  if (!v.visible) { root.hidden = true; return; }
  root.hidden = false;
  root.className = v.stale ? 'stale' : '';

  var head = el('div', 'srv-head');
  head.appendChild(el('span', 'dot ' + v.tone));
  head.appendChild(el('strong', 'srv-title', 'MCP HTTP server'));
  head.appendChild(el('span', 'srv-headline', v.headline));
  root.appendChild(head);
  if (v.detail) root.appendChild(el('p', 'srv-detail', v.detail));
  if (panelState.note) root.appendChild(el('p', 'srv-note', panelState.note));

  if (v.buttons.length) {
    var actions = el('div', 'srv-actions');
    v.buttons.forEach(function (b) {
      actions.appendChild(button(b.label, function () { sendAction(root, b.id); }, b.disabled));
    });
    root.appendChild(actions);
  }

  if (v.token.visible) {
    var row = el('div', 'srv-token');
    row.appendChild(el('span', 'srv-token-label', 'Bearer token'));
    row.appendChild(el('code', 'token', v.token.text));
    if (v.token.canReveal) {
      row.appendChild(button(v.token.revealLabel, function () { toggleReveal(root); }, false));
      row.appendChild(button('Copy', function () { copyToken(root); }, false));
      row.appendChild(button(v.token.rotateLabel, function () { rotateToken(root); }, !v.token.canRotate, 'warn'));
    } else {
      row.appendChild(el('span', 'srv-detail', v.token.hint));
    }
    root.appendChild(row);
  }
}

// ---------------------------------------------------------------- bootstrap

async function refresh(root, status, state, panelRoot) {
  try {
    var pane = await readPane();
    panelState.model = parsePanel(pane.panel);
    if (panelState.pending && panelState.model && panelState.model.ack === panelState.pending.id) panelState.pending = null;
    if (!panelState.model || !panelState.model.token.present) { panelState.revealed = false; panelState.token = null; }
    drawPanel(panelRoot);
    if (panelState.revealed) {
      // The token can be replaced while shown; keep the display honest without waiting for a click.
      readToken().then(function (t) { if (t !== panelState.token) { panelState.token = t; drawPanel(panelRoot); } }).catch(function () {});
    }

    var text = pane.log;
    // Skipping an unchanged render is what keeps an expanded row open: the poll
    // runs every 2s and a rebuilt DOM would collapse whatever the user opened.
    if (!hasChanged(state.lastText, text)) return;
    state.lastText = text;
    render(parseLog(text), root, status, state.expanded);
  } catch (err) {
    panelState.model = null;
    drawPanel(panelRoot);
    root.textContent = '';
    var p = document.createElement('p');
    p.className = 'empty error';
    p.textContent = err.message || String(err);
    root.appendChild(p);
    status.textContent = '';
    state.lastText = null;
  }
}

// Guarded so importing this file in the test runner doesn't try to boot a UI.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  var start = function () {
    var root = document.getElementById('entries');
    var status = document.getElementById('status');
    var panelRoot = document.getElementById('server');
    var state = { lastText: null, expanded: new Set() };
    panelState.refreshNow = function () { refresh(root, status, state, panelRoot); };
    refresh(root, status, state, panelRoot);
    setInterval(function () { refresh(root, status, state, panelRoot); }, REFRESH_MS);
  };
  // SP injects index.html via srcdoc, and whether DOMContentLoaded is still
  // ahead of this script under srcdoc isn't documented. Waiting for an event
  // that already fired would leave the pane blank forever, so branch on
  // readyState rather than trusting the event.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}
