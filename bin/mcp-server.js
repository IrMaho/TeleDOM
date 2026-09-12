import fs from 'fs';
import { JSDOM } from 'jsdom';
// TeleDOM v4.1 MCP Server Runner
import { ForensicMCPServer } from '../dist/server/mcp-server.js';

if (typeof document === 'undefined') {
  let fixtureHtml = `<!DOCTYPE html>
<html>
<head><title>Live DOM</title></head>
<body>
  <header class="card"><h1>Operational DOM Test Fixture</h1></header>
  <main id="main-content">
    <section id="interactive-section">
      <button id="primary-action-btn" class="btn">⚡ Run Analysis</button>
      <input id="search-input" class="input-field" type="text" value="initial query"/>
      <input id="report-file-input" class="upload-field" type="file" accept=".pdf,.png"/>
      <div id="removable-card"><span id="removable-label">Card</span></div>
    </section>
  </main>
</body>
</html>`;

  if (process.env.DOM_FIXTURE_PATH && fs.existsSync(process.env.DOM_FIXTURE_PATH)) {
    fixtureHtml = fs.readFileSync(process.env.DOM_FIXTURE_PATH, 'utf-8');
  }

  const dom = new JSDOM(fixtureHtml, {
    url: 'https://app.internal/dashboard',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
  });

  global.window = dom.window;
  global.document = dom.window.document;
  global.Element = dom.window.Element;
  global.HTMLElement = dom.window.HTMLElement;
  global.HTMLInputElement = dom.window.HTMLInputElement;
  global.HTMLSelectElement = dom.window.HTMLSelectElement;
  global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
  global.MouseEvent = dom.window.MouseEvent;
  global.KeyboardEvent = dom.window.KeyboardEvent;
  global.CustomEvent = dom.window.CustomEvent;
  global.MutationObserver = dom.window.MutationObserver;
  global.Image = dom.window.Image;
  global.Node = dom.window.Node;
  global.Event = dom.window.Event;
  try { global.InputEvent = dom.window.InputEvent; } catch { /* already defined */ }
  try { global.FocusEvent = dom.window.FocusEvent; } catch { /* already defined */ }
  try { global.XPathResult = dom.window.XPathResult; } catch { /* already defined */ }
  try { global.navigator = dom.window.navigator; } catch { /* Node exposes navigator as a getter-only global since v21 */ }

  // MCPDOM v3 simulation marker: background commands (tab/extension control)
  // operate on deterministic virtual state instead of destroying the JSDOM
  // fixture window via window.close()/location.reload().
  global.__FORENSIC_SIMULATION__ = true;
}

const profileArg = process.argv.find((a) => a.startsWith('--profile='));
if (profileArg) {
  process.env.TELEDOM_PROFILE = profileArg.split('=')[1];
} else {
  const profileIdx = process.argv.indexOf('--profile');
  if (profileIdx !== -1 && process.argv[profileIdx + 1]) {
    process.env.TELEDOM_PROFILE = process.argv[profileIdx + 1];
  }
}

const server = new ForensicMCPServer();
server.startStdio();
