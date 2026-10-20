/**
 * When the SP plugin launches the server (009-FR-011) it passes `--parent-pid <SP's pid>`. The server then
 * follows that process: if Super Productivity quits or crashes, nothing else would stop a
 * detached child, so it would sit on its port forever. A hand-run `--http` has no parent.
 */

/** Signal 0 checks existence without sending anything. EPERM still means "exists". */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function parseParentPid(argv: string[]): number | undefined {
  let raw: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--parent-pid') { raw = argv[i + 1]; break; }
    if (a.startsWith('--parent-pid=')) { raw = a.slice('--parent-pid='.length); break; }
  }
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const pid = Number(raw);
  return pid > 0 ? pid : undefined;
}

/** Poll the parent; call `onGone` once when it disappears. Returns a canceller. */
export function watchParent(
  pid: number,
  onGone: () => void,
  intervalMs = 5000,
  alive: (pid: number) => boolean = isProcessAlive,
): () => void {
  let fired = false;
  const timer = setInterval(() => {
    if (fired || alive(pid)) return;
    fired = true;
    clearInterval(timer);
    onGone();
  }, intervalMs);
  timer.unref(); // the HTTP listener, not this watcher, is what keeps the process running
  return () => clearInterval(timer);
}
