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
 * Identity of an entry across refreshes. The log is append-only and a tool call
 * is unique by the instant it started plus its name, so this survives new
 * entries arriving above it.
 */
function entryKey(entry) {
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseLog: parseLog, formatDuration: formatDuration, formatTime: formatTime,
    entryKey: entryKey, hasChanged: hasChanged,
  };
}

// ---------------------------------------------------------------- reading the log

// Probes the same candidates plugin.js resolves, but only looks for an existing
// log — the pane must never create directories or decide where the IPC dir goes.
var READ_LOG_SCRIPT = [
  "const fs = require('fs');",
  "const path = require('path');",
  "const os = require('os');",
  "const home = os.homedir();",
  "const APP = 'super-productivity-mcp';",
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
  "for (const dir of candidates) {",
  "  const file = path.join(dir, '" + LOG_FILENAME + "');",
  "  if (fs.existsSync(file)) return { text: fs.readFileSync(file, 'utf-8'), path: file };",
  "}",
  "return { text: '', path: null };",
].join('\n');

function unwrap(result) {
  return result && result.success && result.result && typeof result.result === 'object' ? result.result : result;
}

async function readLog() {
  if (typeof PluginAPI === 'undefined' || typeof PluginAPI.executeNodeScript !== 'function') {
    throw new Error('This pane needs Node execution. Enable it for the plugin in Super Productivity settings.');
  }
  var res = unwrap(await PluginAPI.executeNodeScript({ script: READ_LOG_SCRIPT, timeout: 5000 }));
  if (!res || res.success === false) throw new Error((res && res.error) || 'Could not read the log');
  return (res.result && res.result.text) || res.text || '';
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

// ---------------------------------------------------------------- bootstrap

async function refresh(root, status, state) {
  try {
    var text = await readLog();
    // Skipping an unchanged render is what keeps an expanded row open: the poll
    // runs every 2s and a rebuilt DOM would collapse whatever the user opened.
    if (!hasChanged(state.lastText, text)) return;
    state.lastText = text;
    render(parseLog(text), root, status, state.expanded);
  } catch (err) {
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
  window.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('entries');
    var status = document.getElementById('status');
    var state = { lastText: null, expanded: new Set() };
    refresh(root, status, state);
    setInterval(function () { refresh(root, status, state); }, REFRESH_MS);
  });
}
