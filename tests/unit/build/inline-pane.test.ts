import { describe, it, expect } from 'vitest';
import { inlinePaneScript } from '../../../scripts/build-plugin.mjs';

// SP does not serve arbitrary files from the plugin ZIP to the iframe — only
// index.html itself is loaded (via srcdoc). A <script src="dashboard.js"> tag
// silently fetches nothing, which is why the pane rendered its header and then
// stopped. The pane's JS has to be inlined at build time.
describe('inlinePaneScript', () => {
  const html = '<body>\n  <main id="entries"></main>\n  <script src="dashboard.js"></script>\n</body>';

  it('replaces the external script tag with the script body', () => {
    const out = inlinePaneScript(html, 'function parseLog() { return []; }');
    expect(out).toContain('function parseLog()');
  });

  it('leaves no external src reference behind', () => {
    const out = inlinePaneScript(html, 'var x = 1;');
    expect(out).not.toContain('src="dashboard.js"');
  });

  it('keeps the rest of the document intact', () => {
    const out = inlinePaneScript(html, 'var x = 1;');
    expect(out).toContain('<main id="entries"></main>');
  });

  it('strips the CommonJS export block, which has no meaning in a browser', () => {
    const js = "var a = 1;\nif (typeof module !== 'undefined' && module.exports) {\n  module.exports = { a: a };\n}\nvar b = 2;";
    const out = inlinePaneScript(html, js);
    expect(out).not.toContain('module.exports');
    expect(out).toContain('var a = 1;');
    expect(out).toContain('var b = 2;');
  });

  it('does not let a closing tag in the JS break out of the script element', () => {
    const out = inlinePaneScript(html, 'var s = "</script>";');
    expect(out).not.toContain('"</script>"');
    expect(out).toContain('<\\/script>');
  });

  it('throws when the expected tag is missing, rather than shipping a dead pane', () => {
    expect(() => inlinePaneScript('<body></body>', 'var x = 1;')).toThrow(/dashboard\.js/);
  });
});
