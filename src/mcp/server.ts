import * as readline from 'readline';
import * as fs from 'fs';
import { JSONRPCRequest, JSONRPCResponse } from '../types/mcp-types';
import { FORENSIC_MCP_TOOLS } from './tools-definition';
import { FileStorageProvider } from '../storage/file-storage';

import { MCPToolsHandler } from './tools-handler';
import { MCPResourcesHandler } from './resources-handler';
import { ForensicStorageProvider } from '../storage/storage-interface';
import { LiveToolsHandler, BrowserBridgeClient } from './live-tools-handler';
import { MCPBridgeServer } from './bridge-server';
import { BrowserCommandType } from '../types/browser-control';
import { TELEDOM_VERSION } from '../intelligence/version';
import { TELEDOM_PROFILE_TOOLS } from './tool-groups';
import { PNGBuilder } from '../core/png-builder';

export { FORENSIC_MCP_TOOLS, FileStorageProvider, MCPToolsHandler, TELEDOM_PROFILE_TOOLS, PNGBuilder };

export class ForensicMCPServer {
  private storage: ForensicStorageProvider;
  private toolsHandler: MCPToolsHandler;
  private resourcesHandler: MCPResourcesHandler;
  private bridgeServer: MCPBridgeServer | null = null;
  private protocolVersion: string = '2024-11-05';
  // v4.1 fix (E-1): derive serverInfo from the authoritative version
  // registry — never hardcode (was stale '12.0.0' while package was 4.0.0).
  private serverInfo = {
    name: 'teledom',
    version: TELEDOM_VERSION.version,
  };

  constructor(storage?: ForensicStorageProvider, liveToolsHandler?: LiveToolsHandler) {
    const storageDir = process.env.FORENSIC_STORAGE_DIR || './.forensic_sessions';
    this.storage = storage || new FileStorageProvider(storageDir);
    this.toolsHandler = new MCPToolsHandler(this.storage, liveToolsHandler);
    this.resourcesHandler = new MCPResourcesHandler(this.storage);

    const bridgePort = parseInt(process.env.FORENSIC_BRIDGE_PORT || '3847', 10);
    const autoBridge = process.env.FORENSIC_AUTO_BRIDGE !== 'false';
    if (autoBridge) {
      this.startBridgeServer().catch(() => {
        this.connectToExistingBridge(`http://127.0.0.1:${bridgePort}`);
      });
    } else {
      this.connectToExistingBridge(`http://127.0.0.1:${bridgePort}`);
    }
  }

  public async startBridgeServer(): Promise<void> {
    const bridgePort = parseInt(process.env.FORENSIC_BRIDGE_PORT || '3847', 10);
    try {
      this.bridgeServer = new MCPBridgeServer(bridgePort, this.storage);
      await this.bridgeServer.start();
      this.toolsHandler.getLiveToolsHandler().setBridgeClient(this.bridgeServer);
      this.toolsHandler.getExtendedToolsHandler().setBridgeClient(this.bridgeServer);
      process.stderr.write(`[MCP] Started background WebSocket Bridge on ws://127.0.0.1:${bridgePort}\n`);
    } catch (err: any) {
      if (err?.code === 'EADDRINUSE') {
        this.connectToExistingBridge(`http://127.0.0.1:${bridgePort}`);
      } else {
        process.stderr.write(`[MCP] Bridge startup note: ${err.message}\n`);
      }
    }
  }

  private connectToExistingBridge(bridgeHttpUrl: string): void {
    const remoteClient: BrowserBridgeClient = {
      sendCommand: async (command: BrowserCommandType, payload?: any) => {
        const toolMap: Record<BrowserCommandType, string> = {
          LIVE_PAGE_INSPECT: 'inspect_live_page',
          LIVE_ELEMENT_INSPECT: 'inspect_live_element',
          GET_SELECTED_ELEMENT: 'get_selected_element',
          ELEMENT_PICKER_START: 'start_element_picker',
          ELEMENT_PICKER_STOP: 'stop_element_picker',
          ELEMENT_SELECTED: 'get_selected_element',
          LIVE_PAGE_SCREENSHOT: 'capture_page_screenshot',
          LIVE_ELEMENT_SCREENSHOT: 'capture_element_screenshot',
          LIVE_ELEMENT_INTERACT: 'interact_with_element',
          ELEMENT_OBSERVATION_START: 'start_element_observation',
          ELEMENT_OBSERVATION_STOP: 'stop_element_observation',
          LIVE_DOM_SNAPSHOT: 'get_live_dom_snapshot',
          LIVE_DOM_SUBTREE: 'get_live_dom_subtree',
          GET_ELEMENT_VISUAL_STATE: 'get_element_visual_state',
          LIST_TABS: 'list_tabs',
          FOCUS_TAB: 'focus_tab',
          RELOAD_TAB: 'reload_tab',
          CLOSE_TAB: 'close_tab',
          OPEN_TAB: 'open_tab',
          LIST_EXTENSIONS: 'list_extensions',
          RELOAD_EXTENSION: 'reload_extension',
          SET_EXTENSION_ENABLED: 'set_extension_enabled',
          TOGGLE_EXTENSION: 'toggle_extension',
          EXECUTE_PIPELINE: 'execute_pipeline',
          COMPARE_EXTENSION_STATES: 'compare_extension_states',
          GET_TAB_CONSOLE_LOGS: 'get_tab_console_logs',
          GET_TAB_NETWORK_REQUESTS: 'get_tab_network_requests',
          // MCPDOM v3 platform evolution commands — mapped to their tools
          RESIZE_VIEWPORT: 'resize_viewport',
          RESET_VIEWPORT: 'reset_viewport',
          GET_VIEWPORT_STATE: 'get_viewport_state',
          RUN_RESPONSIVE_TEST: 'run_responsive_test',
          EMULATE_DEVICE: 'emulate_device',
          EXECUTE_JS: 'execute_javascript',
          EXECUTE_JS_AND_CAPTURE_CHANGES: 'execute_js_and_capture_changes',
          DOM_MUTATE: 'mutate_dom',
          DOM_MUTATE_TRANSACTION: 'mutate_dom_transaction',
          UNDO_DOM_MUTATION: 'undo_dom_mutation',
          REDO_DOM_MUTATION: 'redo_dom_mutation',
          GET_MUTATION_HISTORY: 'get_mutation_history',
          PREVIEW_DOM_MUTATION: 'preview_dom_mutation',
          GENERATE_ELEMENT_TARGET: 'generate_element_target',
          RECOVER_SELECTOR: 'recover_selector',
          GET_ELEMENT_ANCESTRY: 'get_element_ancestry',
          GET_ELEMENT_FINGERPRINT: 'get_element_fingerprint',
          GET_ELEMENT_RELATIONSHIPS: 'get_element_relationships',
          GET_ELEMENT_ACCESSIBILITY: 'get_element_accessibility',
          GET_COMPUTED_STYLE: 'get_computed_style',
          ANALYZE_DOM: 'analyze_dom',
          DRAG_ELEMENT: 'drag_and_drop',
          SET_INPUT_CHECKED: 'set_input_checked',
          PRESS_KEYBOARD_SHORTCUT: 'press_keyboard_shortcut',
          SCROLL_PAGE: 'scroll_page',
          WAIT_FOR_CONDITION: 'wait_for_condition',
          // v4.1 fix (E-12): GET_PAGE_STATE / GET_SIMULATION_TAB_STATE
          // previously mapped to non-existent tools ('get_page_state',
          // 'get_tab_state') — every fallback call died as "Unknown tool".
          GET_PAGE_STATE: 'get_browser_session',
          CAPTURE_PAGE_STATE: 'capture_page_state',
          GET_SIMULATION_TAB_STATE: 'get_viewport_state',
          CAPTURE_REGION: 'capture_page_region',
        };
        const toolName = toolMap[command] || command.toLowerCase();
        try {
          const res = await fetch(`${bridgeHttpUrl}/api/mcp/tool`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: toolName,
              arguments: payload || {},
            }),
          });
          const json = await res.json();
          if (json.isError) {
            throw new Error(json.error || json.content?.[0]?.text || 'Remote bridge command failed');
          }
          try {
            return JSON.parse(json.content[0].text);
          } catch {
            return json.content[0].text;
          }
        } catch (fetchErr: any) {
          throw new Error(`Bridge connection error (${bridgeHttpUrl}): ${fetchErr.message}`);
        }
      },
    };
    this.toolsHandler.getLiveToolsHandler().setBridgeClient(remoteClient);
    this.toolsHandler.getExtendedToolsHandler().setBridgeClient(remoteClient);
  }

  public getToolsHandler(): MCPToolsHandler {
    return this.toolsHandler;
  }

  public async handleRequest(request: JSONRPCRequest): Promise<JSONRPCResponse | null> {
    const { method, params, id } = request;

    // Handle notifications (no id) -> strictly return null according to JSON-RPC 2.0
    if (id === undefined || id === null) {
      return null;
    }

    // 1. Initialize
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: this.protocolVersion,
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
            logging: {},
          },
          serverInfo: this.serverInfo,
        },
      };
    }

    // 2. Initialized notification
    if (method === 'notifications/initialized' || method === 'initialized') {
      return null;
    }

    // 3. Ping
    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }

    // 4. Logging setLevel
    if (method === 'logging/setLevel') {
      return { jsonrpc: '2.0', id, result: {} };
    }

    // 5. List Tools
    if (method === 'tools/list') {
      // §36 configuration: optional subsystems can be hidden from tools/list
      // without touching existing MCPDOM semantics (default: all exposed).
      // v4 adds FORENSIC_DISABLE_INTELLIGENCE for the td_* layer.
      const disableDevTools = process.env.FORENSIC_DISABLE_DEVTOOLS === 'true';
      const disableForensics = process.env.FORENSIC_DISABLE_FORENSICS === 'true';
      const disableIntelligence = process.env.FORENSIC_DISABLE_INTELLIGENCE === 'true';
      const profile = (process.env.TELEDOM_PROFILE || 'full').toLowerCase();
      const profileAllowed = TELEDOM_PROFILE_TOOLS[profile];

      let tools = FORENSIC_MCP_TOOLS.filter(
        (t) =>
          !(disableDevTools && t.name.startsWith('dt_')) &&
          !(disableForensics && t.name.startsWith('fx_')) &&
          !(disableIntelligence && t.name.startsWith('td_')),
      );

      if (profileAllowed && Array.isArray(profileAllowed)) {
        const allowedSet = new Set(profileAllowed);
        tools = tools.filter((t) => allowedSet.has(t.name));
      }

      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools,
        },
      };
    }

    // 6. Call Tool
    if (method === 'tools/call') {
      const toolName = (params as any)?.name;
      const toolArgs = (params as any)?.arguments || {};
      const result = await this.toolsHandler.handleToolCall(toolName, toolArgs);
      return {
        jsonrpc: '2.0',
        id,
        result,
      };
    }

    // 7. List Resources
    if (method === 'resources/list') {
      const resources = await this.resourcesHandler.listResources();
      return {
        jsonrpc: '2.0',
        id,
        result: { resources },
      };
    }

    // 8. Resource Templates List
    if (method === 'resources/templates/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { resourceTemplates: [] },
      };
    }

    // 9. Read Resource
    if (method === 'resources/read') {
      const uri = (params as any)?.uri || '';
      try {
        const content = await this.resourcesHandler.readResource(uri);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [content],
          },
        };
      } catch (err: any) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: err.message,
          },
        };
      }
    }

    // 10. Prompts List
    if (method === 'prompts/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          prompts: [
            {
              name: 'diagnose_disappearing_element',
              description: 'Run an autonomous root-cause investigation on why an injected web element disappeared.',
              arguments: [
                { name: 'sessionId', description: 'ID of the session', required: true },
                { name: 'targetSelector', description: 'CSS selector of the disappearing element', required: true },
              ],
            },
            {
              name: 'compare_dom_states',
              description: 'Perform a structural diff and timeline causality analysis between two timestamps.',
              arguments: [
                { name: 'sessionId', description: 'ID of the session', required: true },
                { name: 't1', description: 'Timestamp before the change (ms)', required: true },
                { name: 't2', description: 'Timestamp after the change (ms)', required: true },
              ],
            },
          ],
        },
      };
    }

    // 10b. Prompts Get (v4.1 fix E-13: prompts/list was advertised without
    // a prompts/get handler — an MCP protocol violation returning -32601).
    if (method === 'prompts/get') {
      const promptName = params?.name;
      const promptArgs = (params?.arguments ?? {}) as Record<string, string>;
      if (promptName === 'diagnose_disappearing_element') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            description: 'Run an autonomous root-cause investigation on why an injected web element disappeared.',
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `Investigate why the element "${promptArgs.targetSelector ?? '<targetSelector>'}" disappeared in session "${promptArgs.sessionId ?? '<sessionId>'}". Use td_investigate with objective="why did ${promptArgs.targetSelector ?? '<targetSelector>'} disappear", symptomPattern matching the element, and sessionId. Then report the root cause with evidence (td_evidence_chain) and attach proof (td_evidence_proof).`,
                },
              },
            ],
          },
        };
      }
      if (promptName === 'compare_dom_states') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            description: 'Perform a structural diff and timeline causality analysis between two timestamps.',
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `Compare DOM states of session "${promptArgs.sessionId ?? '<sessionId>'}" at t1=${promptArgs.t1 ?? '<t1>'} and t2=${promptArgs.t2 ?? '<t2>'}. Use td_temporal_window around both points, td_state_diff for the structural change, and td_cause_trace for the causal chain that explains the transition.`,
                },
              },
            ],
          },
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: `Unknown prompt: ${promptName}` },
      };
    }

    // 11. Roots List
    if (method === 'roots/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { roots: [] },
      };
    }

    // 12. Completion Complete
    if (method === 'completion/complete') {
      return {
        jsonrpc: '2.0',
        id,
        result: { completion: { values: [], hasMore: false } },
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method '${method}' not found`,
      },
    };
  }

  public async startStdio(): Promise<void> {
    process.stderr.write(`[MCP] TeleDOM ${TELEDOM_VERSION.version} MCP Server started on stdio\n`);

    // v4.1 fix (E-7): debug log path was a hardcoded private Windows path
    // ('c:/Users/ASUS/…') with a silent catch — stdio debug logging was
    // completely dead. Now env-driven with a safe cwd default, and failures
    // are reported to stderr instead of being swallowed.
    const logPath = process.env.TELEDOM_MCP_DEBUG_LOG || '';
    const appendLog = (msg: string) => {
      if (!logPath) return;
      try {
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
      } catch (err: any) {
        process.stderr.write(`[MCP] debug log write failed: ${err?.message}\n`);
      }
    };
    appendLog('=== MCP Server Started ===');

    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false,
    });

    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      appendLog(`INBOUND: ${trimmed}`);

      try {
        const req: JSONRPCRequest = JSON.parse(trimmed);
        const res = await this.handleRequest(req);
        if (res) {
          const outStr = JSON.stringify(res);
          appendLog(`OUTBOUND: ${outStr}`);
          process.stdout.write(outStr + '\n');
        } else {
          appendLog(`OUTBOUND: (null response for notification)`);
        }
      } catch (err: any) {
        appendLog(`ERROR: ${err.message}`);
        const errorResponse: JSONRPCResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: `Parse error: ${err.message}`,
          },
        };
        process.stdout.write(JSON.stringify(errorResponse) + '\n');
      }
    });
  }
}
