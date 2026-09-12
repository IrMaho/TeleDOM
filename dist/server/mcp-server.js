import * as readline from "readline";
import * as fs from "fs";
import { M as MCPDOM_V3_TOOLS, D as DEVTOOLS_TOOLS, F as FORENSICS_TOOLS, T as TELEDOM_INTELLIGENCE_TOOLS, a as TELEDOM_VERSION, b as FileStorageProvider, c as MCPToolsHandler, MCPBridgeServer, d as TELEDOM_PROFILE_TOOLS } from "./bridge-server.js";
import { P } from "./bridge-server.js";
import "http";
import "ws";
import "path";
import "zlib";
import "crypto";
const FORENSIC_MCP_TOOLS = [
  {
    name: "list_sessions",
    description: "List all recorded browser forensic debugging sessions with metadata, timestamps, and stats.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum number of sessions to return" }
      }
    }
  },
  {
    name: "get_session",
    description: "Retrieve full metadata, capabilities, health status, and statistics for a specific debugging session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Unique identifier of the recording session" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "export_session",
    description: "Export a complete recording session as a portable, self-contained JSON bundle.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Unique identifier of the recording session" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "import_session",
    description: "Import a recording session bundle from raw JSON string.",
    inputSchema: {
      type: "object",
      properties: {
        bundleJson: { type: "string", description: "Raw JSON string of the session bundle" }
      },
      required: ["bundleJson"]
    }
  },
  {
    name: "delete_session",
    description: "Delete a recording session from storage.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Unique identifier of the recording session" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "get_timeline",
    description: "Retrieve summary breakdown of events across the session timeline, including event categories and significant milestones.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "get_events",
    description: "Query recorded events with filtering by category (DOM, USER, ERROR, CONSOLE, NETWORK, etc.), type, timestamp range, target node, or search query.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        category: { type: "string", description: "Filter by category (DOM, USER, ERROR, CONSOLE, NETWORK, NAVIGATION, etc.)" },
        type: { type: "string", description: "Filter by exact event type (e.g. DOM_MUTATION_ADD, RUNTIME_ERROR, USER_CLICK)" },
        fromTimestamp: { type: "number", description: "Start timestamp in milliseconds" },
        toTimestamp: { type: "number", description: "End timestamp in milliseconds" },
        targetNodeId: { type: "number", description: "Filter by affected LogicalNodeId" },
        targetSelector: { type: "string", description: "Filter by CSS selector substring" },
        searchQuery: { type: "string", description: "Search term inside event payload" },
        limit: { type: "number", description: "Max events to return (default: 50)" },
        offset: { type: "number", description: "Offset for pagination" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "get_events_around",
    description: "Retrieve a focused contextual window of events occurring immediately before and after a specific timestamp or event ID.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        timestamp: { type: "number", description: "Target timestamp in milliseconds" },
        eventId: { type: "string", description: "Target event ID" },
        windowMs: { type: "number", description: "Window radius in milliseconds (default: 300ms)" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "get_dom_state",
    description: "Reconstruct the complete DOM snapshot at an arbitrary timestamp or event ID using checkpoint delta replay.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        timestamp: { type: "number", description: "Target timestamp in milliseconds" },
        eventId: { type: "string", description: "Target event ID" },
        format: { type: "string", enum: ["html", "json_summary", "full_nodes"], description: "Output format (default: html)" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "get_dom_node",
    description: "Inspect detailed properties of a specific DOM node at a given timestamp (tag, attributes, text, parent, children, visibility state).",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        timestamp: { type: "number", description: "Timestamp in milliseconds" },
        nodeId: { type: "number", description: "LogicalNodeId to inspect" },
        selector: { type: "string", description: "CSS selector query if nodeId is unknown" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "get_dom_subtree",
    description: "Reconstruct and extract the HTML of a specific subtree (e.g. #app or .gpt-panel) at a given timestamp.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        timestamp: { type: "number", description: "Timestamp in milliseconds" },
        selector: { type: "string", description: "CSS selector for the root of the subtree" },
        nodeId: { type: "number", description: "LogicalNodeId for the root of the subtree" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "diff_dom",
    description: "Compare two DOM states between timestamp T1 and T2 (or event E1 and E2) and return structured additions, removals, moves, attribute, style, and text changes.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        t1: { type: "number", description: "Start timestamp in milliseconds" },
        t2: { type: "number", description: "End timestamp in milliseconds" },
        e1: { type: "string", description: "Start event ID (alternative to t1)" },
        e2: { type: "string", description: "End event ID (alternative to t2)" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "trace_element",
    description: "Trace the entire chronological lifecycle of a DOM element from creation, mounting, mutations, style changes to unmounting/removal.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        nodeId: { type: "number", description: "LogicalNodeId of the element" },
        selector: { type: "string", description: "CSS selector hint for the element" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "find_disappearing_elements",
    description: "Automatically scan the session and identify all elements that existed temporarily and were subsequently removed or hidden.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        maxLifespanMs: { type: "number", description: "Maximum lifespan in ms to consider (default: 5000ms)" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "why_did_element_disappear",
    description: "Forensic root-cause diagnosis for why an injected or existing UI element disappeared. Pinpoints removal mechanism, ancestor container destruction, style changes, and correlated errors/network triggers.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        target: { type: "string", description: "CSS selector or LogicalNodeId of the target element" }
      },
      required: ["sessionId", "target"]
    }
  },
  {
    name: "get_diagnostics",
    description: "Query recorded console messages, runtime errors, and unhandled promise rejections with stack traces.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        level: { type: "string", enum: ["all", "error", "warn", "info", "log"], description: "Log level filter" },
        fromTimestamp: { type: "number", description: "Start timestamp" },
        toTimestamp: { type: "number", description: "End timestamp" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "get_network_events",
    description: "Query recorded network requests and responses correlated with timing and duration.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        statusFilter: { type: "string", enum: ["all", "errors_only", "success_only"], description: "HTTP status filter" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "get_screenshots",
    description: "List visual checkpoints and screenshot checkpoints captured during the recording session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "annotate_session",
    description: "Add an investigative annotation or hypothesis to the session timeline.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        label: { type: "string", description: "Short title for annotation" },
        comment: { type: "string", description: "Detailed investigative note or root-cause finding" },
        nodeId: { type: "number", description: "Optional associated LogicalNodeId" },
        category: { type: "string", enum: ["NOTE", "ROOT_CAUSE", "HYPOTHESIS", "WARNING", "VERIFIED"] }
      },
      required: ["sessionId", "label", "comment"]
    }
  },
  {
    name: "get_annotations",
    description: "Retrieve all human and AI annotations created for a session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" }
      },
      required: ["sessionId"]
    }
  },
  {
    name: "get_recording_health",
    description: "Run an automated integrity audit on a recording session to check sequence monotonicity, missing nodes, and capability health.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" }
      },
      required: ["sessionId"]
    }
  },
  // ==========================================
  // LIVE BROWSER CONTROL, TABS & EXTENSIONS
  // ==========================================
  {
    name: "list_tabs",
    description: "List all open Chrome browser tabs across windows with tab ID, title, URL, active state, window ID, status, and recording status.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "focus_tab",
    description: "Switch active focus to a specific browser tab by tabId and bring its window to the foreground.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "The unique Chrome tab ID to activate and focus" }
      },
      required: ["tabId"]
    }
  },
  {
    name: "reload_tab",
    description: "Reload a specific browser tab or the active tab with optional hard refresh (bypassCache).",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Target Chrome tab ID (defaults to currently active tab if omitted)" },
        bypassCache: { type: "boolean", description: "Whether to ignore cached assets and perform a hard reload (default: false)" }
      }
    }
  },
  {
    name: "close_tab",
    description: 'Close a specific browser tab by tabId, URL substring, or pattern (e.g., "meet", "calendar").',
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Target Chrome tab ID to close" },
        url: { type: "string", description: 'URL substring or pattern of tabs to close (e.g. "meet.google.com")' }
      }
    }
  },
  {
    name: "open_tab",
    description: "Open a new browser tab with the specified URL, meeting link, web page, or local file path in Chrome.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL, web link, meeting link, or file:// path to open" },
        active: { type: "boolean", description: "Whether the new tab should become the active and focused tab (default: true)" },
        pinned: { type: "boolean", description: "Whether the tab should be pinned (default: false)" }
      },
      required: ["url"]
    }
  },
  {
    name: "list_extensions",
    description: "List all installed Chrome extensions with ID, name, version, enabled status, installation type, and permissions.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "set_extension_enabled",
    description: "Enable or disable a specific Chrome extension by ID (e.g. turn off extension to observe native clean UI, then turn back on).",
    inputSchema: {
      type: "object",
      properties: {
        extensionId: { type: "string", description: "The Chrome extension ID to enable or disable" },
        enabled: { type: "boolean", description: "True to enable the extension, false to disable it" }
      },
      required: ["extensionId", "enabled"]
    }
  },
  {
    name: "toggle_extension",
    description: "Toggle the enabled status of a specific Chrome extension by ID.",
    inputSchema: {
      type: "object",
      properties: {
        extensionId: { type: "string", description: "The Chrome extension ID to toggle" }
      },
      required: ["extensionId"]
    }
  },
  {
    name: "execute_pipeline",
    description: "Execute a batch sequence of browser and extension actions in one call (e.g. reload extension, wait, reload tab, take screenshot directly to file, dump DOM to file) and aggregate all results.",
    inputSchema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description: "Ordered array of actions to execute sequentially",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Optional step identifier" },
              action: { type: "string", description: "Tool action name (e.g. reload_extension, set_extension_enabled, reload_tab, wait, capture_page_screenshot, get_live_dom_snapshot, interact_with_element)" },
              params: { type: "object", description: "Parameters for this action" },
              stopOnError: { type: "boolean", description: "Whether to abort subsequent steps if this step fails (default: true)" }
            },
            required: ["action"]
          }
        },
        outputPath: { type: "string", description: "Optional file path to save consolidated JSON report of all pipeline steps" }
      },
      required: ["steps"]
    }
  },
  {
    name: "compare_extension_states",
    description: "Automatically perform a complete before/after comparative forensic audit: disables extension, reloads and captures clean native state/screenshot, enables extension, reloads and captures injected state/screenshot, and returns a detailed differential analysis.",
    inputSchema: {
      type: "object",
      properties: {
        extensionId: { type: "string", description: "Target Chrome extension ID" },
        tabId: { type: "number", description: "Optional target Chrome tab ID (defaults to active tab)" },
        waitDurationMs: { type: "number", description: "Wait time in ms after each reload for DOM to settle (default: 2500)" },
        cleanDomPath: { type: "string", description: "File path to save clean native DOM snapshot HTML" },
        injectedDomPath: { type: "string", description: "File path to save injected DOM snapshot HTML" },
        cleanScreenshotPath: { type: "string", description: "File path to save clean native screenshot PNG" },
        injectedScreenshotPath: { type: "string", description: "File path to save injected screenshot PNG" },
        diffOutputPath: { type: "string", description: "File path to save JSON differential report" }
      },
      required: ["extensionId"]
    }
  },
  {
    name: "reload_extension",
    description: "Reload an extension under development. If extensionId is provided, toggles and reloads that extension. If omitted, reloads the Forensic Recorder extension itself.",
    inputSchema: {
      type: "object",
      properties: {
        extensionId: { type: "string", description: "Extension ID to reload (defaults to current extension if omitted)" }
      }
    }
  },
  {
    name: "get_tab_console_logs",
    description: "Retrieve live intercepted console logs, uncaught JavaScript errors, and unhandled promise rejections for a specific tab or the active tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Target Chrome tab ID (defaults to currently active tab if omitted)" },
        level: { type: "string", enum: ["all", "error", "warn", "info", "log", "debug"], description: "Filter by log severity level (default: all)" },
        searchQuery: { type: "string", description: "Filter logs containing this text or source" },
        limit: { type: "number", description: "Maximum number of recent log entries to return (default: 100)" },
        clearAfterRead: { type: "boolean", description: "Clear the internal log buffer after reading (default: false)" }
      }
    }
  },
  {
    name: "get_tab_network_requests",
    description: "Retrieve live intercepted network requests and responses (Fetch, XHR) for a specific tab or the active tab, including method, URL, status, duration, and errors.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Target Chrome tab ID (defaults to currently active tab if omitted)" },
        method: { type: "string", description: "Filter by HTTP method (GET, POST, PUT, DELETE, etc.)" },
        status: { type: "number", description: "Filter by HTTP status code (e.g. 200, 404, 500)" },
        onlyErrors: { type: "boolean", description: "Return only failed requests or HTTP status >= 400 (default: false)" },
        searchQuery: { type: "string", description: "Filter requests by URL substring" },
        limit: { type: "number", description: "Maximum number of recent network requests to return (default: 100)" },
        clearAfterRead: { type: "boolean", description: "Clear the internal network buffer after reading (default: false)" }
      }
    }
  },
  {
    name: "inspect_live_page",
    description: "Inspect the current live browser page state, including URL, title, viewport dimensions, scroll positions, readyState, active and focused elements.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional target Chrome tab ID (defaults to currently active tab)" }
      }
    }
  },
  {
    name: "inspect_live_element",
    description: "Deeply inspect a live DOM element on the active browser page by CSS selector, LogicalNodeId, or selectedElementRef, returning bounds, computed styles, visibility, attributes, state, role, aria, and parent context.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional target Chrome tab ID (defaults to currently active tab)" },
        selector: { type: "string", description: "CSS selector of the target element" },
        nodeId: { type: "number", description: "LogicalNodeId of the element if recorded" },
        selectedElementRef: { type: "string", description: "Reference token of the last selected element" },
        xpath: { type: "string", description: "XPath expression for the element" }
      }
    }
  },
  {
    name: "get_selected_element",
    description: "Retrieve the DOM element visually selected by the user via Ctrl + Shift + Mouse Click in the live browser.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional target Chrome tab ID (defaults to currently active tab)" }
      }
    }
  },
  {
    name: "start_element_picker",
    description: "Activate the interactive visual element picker mode in the live browser with hover highlighting and click selection.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional target Chrome tab ID (defaults to currently active tab)" },
        highlightColor: { type: "string", description: "Hex color for hover highlighter (default: #0ea5e9)" }
      }
    }
  },
  {
    name: "stop_element_picker",
    description: "Deactivate the visual element picker mode in the browser and restore normal cursor and interaction state.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional target Chrome tab ID (defaults to currently active tab)" }
      }
    }
  },
  {
    name: "capture_page_screenshot",
    description: "Capture a screenshot of the visible browser page viewport with temporal, scroll, and viewport metadata. When outputPath is provided, saves decoded image directly to disk.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional target Chrome tab ID (defaults to currently active tab)" },
        format: { type: "string", enum: ["png", "jpeg"], description: "Image format (default: png)" },
        outputPath: { type: "string", description: "Optional file path to save decoded PNG/JPEG image directly to disk" }
      }
    }
  },
  {
    name: "capture_element_screenshot",
    description: "Capture an element-specific screenshot bounded to the target element exact geometry and device pixel ratio. When outputPath is provided, saves decoded image directly to disk.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional target Chrome tab ID (defaults to currently active tab)" },
        outputPath: { type: "string", description: "Optional file path to save decoded element PNG/JPEG image directly to disk" },
        selector: { type: "string", description: "CSS selector of the target element" },
        nodeId: { type: "number", description: "LogicalNodeId of the target element" },
        selectedElementRef: { type: "string", description: "Selected element reference token" }
      }
    }
  },
  {
    name: "interact_with_element",
    description: "Perform an interaction (click, double_click, right_click, hover, focus, blur, type, clear, press_key, select_option, scroll_into_view, scroll) on a live element and return before/after state and effect measurements.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional target Chrome tab ID (defaults to currently active tab)" },
        action: {
          type: "string",
          enum: [
            "click",
            "double_click",
            "right_click",
            "hover",
            "focus",
            "blur",
            "type",
            "clear",
            "press_key",
            "select_option",
            "scroll_into_view",
            "scroll"
          ],
          description: "The user action to perform"
        },
        selector: { type: "string", description: "CSS selector of the target element" },
        nodeId: { type: "number", description: "LogicalNodeId of the target element" },
        selectedElementRef: { type: "string", description: "Selected element reference token" },
        text: { type: "string", description: "Text string for type action" },
        key: { type: "string", description: "Key name for press_key action (e.g. Enter, Escape, Tab, ArrowDown)" },
        optionValue: { type: "string", description: "Value or label for select_option action" },
        scrollDelta: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" } },
          description: "Scroll deltas for scroll action"
        },
        waitForStabilization: { type: "boolean", description: "Wait for DOM and network stabilization after interaction (default: true)" },
        stabilizationTimeoutMs: { type: "number", description: "Max wait time in milliseconds (default: 300ms)" }
      },
      required: ["action"]
    }
  },
  {
    name: "start_element_observation",
    description: "Start focused continuous recording and observation around a target element and its subtree/ancestors.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional target Chrome tab ID (defaults to currently active tab)" },
        selector: { type: "string", description: "CSS selector of the target element" },
        nodeId: { type: "number", description: "LogicalNodeId of the target element" }
      }
    }
  },
  {
    name: "stop_element_observation",
    description: "Stop focused element observation and assemble a complete correlation bundle with mutations, diagnostics, network activity, and root-cause analysis.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional target Chrome tab ID (defaults to currently active tab)" }
      }
    }
  },
  {
    name: "get_live_dom_snapshot",
    description: "Capture the current live virtual DOM state snapshot of the active or specified browser tab in HTML or structured JSON format.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional target Chrome tab ID (defaults to currently active tab)" },
        format: { type: "string", enum: ["html", "json"], description: "Output format (default: html)" }
      }
    }
  },
  {
    name: "get_live_dom_subtree",
    description: "Reconstruct and extract the live HTML or node structure of a specific subtree on the active or specified browser tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional target Chrome tab ID (defaults to currently active tab)" },
        selector: { type: "string", description: "CSS selector of the subtree root" },
        nodeId: { type: "number", description: "LogicalNodeId of the subtree root" }
      }
    }
  },
  {
    name: "get_element_visual_state",
    description: "Inspect detailed visual layout, occlusion, clipping, opacity, z-index, and viewport visibility for a live element.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Optional target Chrome tab ID (defaults to currently active tab)" },
        selector: { type: "string", description: "CSS selector of the target element" },
        nodeId: { type: "number", description: "LogicalNodeId of the target element" }
      }
    }
  },
  ...MCPDOM_V3_TOOLS,
  // §8 Chrome DevTools MCP capability families (dt_ namespace, no collisions)
  ...DEVTOOLS_TOOLS,
  // §17 the 30 MCPDOM-native advanced forensic capabilities (fx_ namespace)
  ...FORENSICS_TOOLS,
  // TeleDOM v4 — the 100 td_* intelligence surface (temporal, evidence,
  // causal, semantic, targeting, simulation, reliability, security,
  // performance, investigation) generated from the capability registry.
  ...TELEDOM_INTELLIGENCE_TOOLS
];
class MCPResourcesHandler {
  storage;
  constructor(storage) {
    this.storage = storage;
  }
  async listResources() {
    const sessions = await this.storage.listSessions();
    const resources = [];
    for (const session of sessions) {
      resources.push({
        uri: `forensic://sessions/${session.id}`,
        name: `Session: ${session.name}`,
        mimeType: "application/json",
        description: `Browser forensic recording session from ${session.url} (${session.stats.eventCount} events)`
      });
      resources.push({
        uri: `forensic://sessions/${session.id}/timeline`,
        name: `Timeline: ${session.name}`,
        mimeType: "text/markdown",
        description: `Markdown summary of the event timeline for session ${session.id}`
      });
    }
    return resources;
  }
  async readResource(uri) {
    const sessionMatch = uri.match(/^forensic:\/\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const sessionId = sessionMatch[1];
      const session = await this.storage.getSession(sessionId);
      if (!session) throw new Error(`Resource not found: ${uri}`);
      return {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(session, null, 2)
      };
    }
    const timelineMatch = uri.match(/^forensic:\/\/sessions\/([^/]+)\/timeline$/);
    if (timelineMatch) {
      const sessionId = timelineMatch[1];
      const session = await this.storage.getSession(sessionId);
      const events = await this.storage.getEvents(sessionId);
      if (!session) throw new Error(`Resource not found: ${uri}`);
      const lines = [
        `# Timeline for Session: ${session.name} (${session.id})`,
        `- **URL**: ${session.url}`,
        `- **Total Events**: ${events.length}`,
        `- **Duration**: ${session.durationMs?.toFixed(1) || "0"}ms`,
        "",
        "## Significant Events"
      ];
      for (const evt of events.slice(0, 50)) {
        lines.push(`- **[${evt.timestamp.toFixed(1)}ms]** \`${evt.type}\` (${evt.category}) ${evt.targetSelector ? `on \`${evt.targetSelector}\`` : ""}`);
      }
      return {
        uri,
        mimeType: "text/markdown",
        text: lines.join("\n")
      };
    }
    throw new Error(`Unsupported resource URI: ${uri}`);
  }
}
class ForensicMCPServer {
  storage;
  toolsHandler;
  resourcesHandler;
  bridgeServer = null;
  protocolVersion = "2024-11-05";
  // v4.1 fix (E-1): derive serverInfo from the authoritative version
  // registry — never hardcode (was stale '12.0.0' while package was 4.0.0).
  serverInfo = {
    name: "teledom",
    version: TELEDOM_VERSION.version
  };
  constructor(storage, liveToolsHandler) {
    const storageDir = process.env.FORENSIC_STORAGE_DIR || "./.forensic_sessions";
    this.storage = storage || new FileStorageProvider(storageDir);
    this.toolsHandler = new MCPToolsHandler(this.storage, liveToolsHandler);
    this.resourcesHandler = new MCPResourcesHandler(this.storage);
    const bridgePort = parseInt(process.env.FORENSIC_BRIDGE_PORT || "3847", 10);
    const autoBridge = process.env.FORENSIC_AUTO_BRIDGE !== "false";
    if (autoBridge) {
      this.startBridgeServer().catch(() => {
        this.connectToExistingBridge(`http://127.0.0.1:${bridgePort}`);
      });
    } else {
      this.connectToExistingBridge(`http://127.0.0.1:${bridgePort}`);
    }
  }
  async startBridgeServer() {
    const bridgePort = parseInt(process.env.FORENSIC_BRIDGE_PORT || "3847", 10);
    try {
      this.bridgeServer = new MCPBridgeServer(bridgePort, this.storage);
      await this.bridgeServer.start();
      this.toolsHandler.getLiveToolsHandler().setBridgeClient(this.bridgeServer);
      this.toolsHandler.getExtendedToolsHandler().setBridgeClient(this.bridgeServer);
      process.stderr.write(`[MCP] Started background WebSocket Bridge on ws://127.0.0.1:${bridgePort}
`);
    } catch (err) {
      if (err?.code === "EADDRINUSE") {
        this.connectToExistingBridge(`http://127.0.0.1:${bridgePort}`);
      } else {
        process.stderr.write(`[MCP] Bridge startup note: ${err.message}
`);
      }
    }
  }
  connectToExistingBridge(bridgeHttpUrl) {
    const remoteClient = {
      sendCommand: async (command, payload) => {
        const toolMap = {
          LIVE_PAGE_INSPECT: "inspect_live_page",
          LIVE_ELEMENT_INSPECT: "inspect_live_element",
          GET_SELECTED_ELEMENT: "get_selected_element",
          ELEMENT_PICKER_START: "start_element_picker",
          ELEMENT_PICKER_STOP: "stop_element_picker",
          ELEMENT_SELECTED: "get_selected_element",
          LIVE_PAGE_SCREENSHOT: "capture_page_screenshot",
          LIVE_ELEMENT_SCREENSHOT: "capture_element_screenshot",
          LIVE_ELEMENT_INTERACT: "interact_with_element",
          ELEMENT_OBSERVATION_START: "start_element_observation",
          ELEMENT_OBSERVATION_STOP: "stop_element_observation",
          LIVE_DOM_SNAPSHOT: "get_live_dom_snapshot",
          LIVE_DOM_SUBTREE: "get_live_dom_subtree",
          GET_ELEMENT_VISUAL_STATE: "get_element_visual_state",
          LIST_TABS: "list_tabs",
          FOCUS_TAB: "focus_tab",
          RELOAD_TAB: "reload_tab",
          CLOSE_TAB: "close_tab",
          OPEN_TAB: "open_tab",
          LIST_EXTENSIONS: "list_extensions",
          RELOAD_EXTENSION: "reload_extension",
          SET_EXTENSION_ENABLED: "set_extension_enabled",
          TOGGLE_EXTENSION: "toggle_extension",
          EXECUTE_PIPELINE: "execute_pipeline",
          COMPARE_EXTENSION_STATES: "compare_extension_states",
          GET_TAB_CONSOLE_LOGS: "get_tab_console_logs",
          GET_TAB_NETWORK_REQUESTS: "get_tab_network_requests",
          // MCPDOM v3 platform evolution commands — mapped to their tools
          RESIZE_VIEWPORT: "resize_viewport",
          RESET_VIEWPORT: "reset_viewport",
          GET_VIEWPORT_STATE: "get_viewport_state",
          RUN_RESPONSIVE_TEST: "run_responsive_test",
          EMULATE_DEVICE: "emulate_device",
          EXECUTE_JS: "execute_javascript",
          EXECUTE_JS_AND_CAPTURE_CHANGES: "execute_js_and_capture_changes",
          DOM_MUTATE: "mutate_dom",
          DOM_MUTATE_TRANSACTION: "mutate_dom_transaction",
          UNDO_DOM_MUTATION: "undo_dom_mutation",
          REDO_DOM_MUTATION: "redo_dom_mutation",
          GET_MUTATION_HISTORY: "get_mutation_history",
          PREVIEW_DOM_MUTATION: "preview_dom_mutation",
          GENERATE_ELEMENT_TARGET: "generate_element_target",
          RECOVER_SELECTOR: "recover_selector",
          GET_ELEMENT_ANCESTRY: "get_element_ancestry",
          GET_ELEMENT_FINGERPRINT: "get_element_fingerprint",
          GET_ELEMENT_RELATIONSHIPS: "get_element_relationships",
          GET_ELEMENT_ACCESSIBILITY: "get_element_accessibility",
          GET_COMPUTED_STYLE: "get_computed_style",
          ANALYZE_DOM: "analyze_dom",
          DRAG_ELEMENT: "drag_and_drop",
          SET_INPUT_CHECKED: "set_input_checked",
          PRESS_KEYBOARD_SHORTCUT: "press_keyboard_shortcut",
          SCROLL_PAGE: "scroll_page",
          WAIT_FOR_CONDITION: "wait_for_condition",
          // v4.1 fix (E-12): GET_PAGE_STATE / GET_SIMULATION_TAB_STATE
          // previously mapped to non-existent tools ('get_page_state',
          // 'get_tab_state') — every fallback call died as "Unknown tool".
          GET_PAGE_STATE: "get_browser_session",
          CAPTURE_PAGE_STATE: "capture_page_state",
          GET_SIMULATION_TAB_STATE: "get_viewport_state",
          CAPTURE_REGION: "capture_page_region"
        };
        const toolName = toolMap[command] || command.toLowerCase();
        try {
          const res = await fetch(`${bridgeHttpUrl}/api/mcp/tool`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: toolName,
              arguments: payload || {}
            })
          });
          const json = await res.json();
          if (json.isError) {
            throw new Error(json.error || json.content?.[0]?.text || "Remote bridge command failed");
          }
          try {
            return JSON.parse(json.content[0].text);
          } catch {
            return json.content[0].text;
          }
        } catch (fetchErr) {
          throw new Error(`Bridge connection error (${bridgeHttpUrl}): ${fetchErr.message}`);
        }
      }
    };
    this.toolsHandler.getLiveToolsHandler().setBridgeClient(remoteClient);
    this.toolsHandler.getExtendedToolsHandler().setBridgeClient(remoteClient);
  }
  getToolsHandler() {
    return this.toolsHandler;
  }
  async handleRequest(request) {
    const { method, params, id } = request;
    if (id === void 0 || id === null) {
      return null;
    }
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: this.protocolVersion,
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
            logging: {}
          },
          serverInfo: this.serverInfo
        }
      };
    }
    if (method === "notifications/initialized" || method === "initialized") {
      return null;
    }
    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }
    if (method === "logging/setLevel") {
      return { jsonrpc: "2.0", id, result: {} };
    }
    if (method === "tools/list") {
      const disableDevTools = process.env.FORENSIC_DISABLE_DEVTOOLS === "true";
      const disableForensics = process.env.FORENSIC_DISABLE_FORENSICS === "true";
      const disableIntelligence = process.env.FORENSIC_DISABLE_INTELLIGENCE === "true";
      const profile = (process.env.TELEDOM_PROFILE || "full").toLowerCase();
      const profileAllowed = TELEDOM_PROFILE_TOOLS[profile];
      let tools = FORENSIC_MCP_TOOLS.filter(
        (t) => !(disableDevTools && t.name.startsWith("dt_")) && !(disableForensics && t.name.startsWith("fx_")) && !(disableIntelligence && t.name.startsWith("td_"))
      );
      if (profileAllowed && Array.isArray(profileAllowed)) {
        const allowedSet = new Set(profileAllowed);
        tools = tools.filter((t) => allowedSet.has(t.name));
      }
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools
        }
      };
    }
    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const result = await this.toolsHandler.handleToolCall(toolName, toolArgs);
      return {
        jsonrpc: "2.0",
        id,
        result
      };
    }
    if (method === "resources/list") {
      const resources = await this.resourcesHandler.listResources();
      return {
        jsonrpc: "2.0",
        id,
        result: { resources }
      };
    }
    if (method === "resources/templates/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: { resourceTemplates: [] }
      };
    }
    if (method === "resources/read") {
      const uri = params?.uri || "";
      try {
        const content = await this.resourcesHandler.readResource(uri);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            contents: [content]
          }
        };
      } catch (err) {
        return {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32602,
            message: err.message
          }
        };
      }
    }
    if (method === "prompts/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          prompts: [
            {
              name: "diagnose_disappearing_element",
              description: "Run an autonomous root-cause investigation on why an injected web element disappeared.",
              arguments: [
                { name: "sessionId", description: "ID of the session", required: true },
                { name: "targetSelector", description: "CSS selector of the disappearing element", required: true }
              ]
            },
            {
              name: "compare_dom_states",
              description: "Perform a structural diff and timeline causality analysis between two timestamps.",
              arguments: [
                { name: "sessionId", description: "ID of the session", required: true },
                { name: "t1", description: "Timestamp before the change (ms)", required: true },
                { name: "t2", description: "Timestamp after the change (ms)", required: true }
              ]
            }
          ]
        }
      };
    }
    if (method === "prompts/get") {
      const promptName = params?.name;
      const promptArgs = params?.arguments ?? {};
      if (promptName === "diagnose_disappearing_element") {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            description: "Run an autonomous root-cause investigation on why an injected web element disappeared.",
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: `Investigate why the element "${promptArgs.targetSelector ?? "<targetSelector>"}" disappeared in session "${promptArgs.sessionId ?? "<sessionId>"}". Use td_investigate with objective="why did ${promptArgs.targetSelector ?? "<targetSelector>"} disappear", symptomPattern matching the element, and sessionId. Then report the root cause with evidence (td_evidence_chain) and attach proof (td_evidence_proof).`
                }
              }
            ]
          }
        };
      }
      if (promptName === "compare_dom_states") {
        return {
          jsonrpc: "2.0",
          id,
          result: {
            description: "Perform a structural diff and timeline causality analysis between two timestamps.",
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: `Compare DOM states of session "${promptArgs.sessionId ?? "<sessionId>"}" at t1=${promptArgs.t1 ?? "<t1>"} and t2=${promptArgs.t2 ?? "<t2>"}. Use td_temporal_window around both points, td_state_diff for the structural change, and td_cause_trace for the causal chain that explains the transition.`
                }
              }
            ]
          }
        };
      }
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `Unknown prompt: ${promptName}` }
      };
    }
    if (method === "roots/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: { roots: [] }
      };
    }
    if (method === "completion/complete") {
      return {
        jsonrpc: "2.0",
        id,
        result: { completion: { values: [], hasMore: false } }
      };
    }
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method '${method}' not found`
      }
    };
  }
  async startStdio() {
    process.stderr.write(`[MCP] TeleDOM ${TELEDOM_VERSION.version} MCP Server started on stdio
`);
    const logPath = process.env.TELEDOM_MCP_DEBUG_LOG || "";
    const appendLog = (msg) => {
      if (!logPath) return;
      try {
        fs.appendFileSync(logPath, `[${(/* @__PURE__ */ new Date()).toISOString()}] ${msg}
`);
      } catch (err) {
        process.stderr.write(`[MCP] debug log write failed: ${err?.message}
`);
      }
    };
    appendLog("=== MCP Server Started ===");
    const rl = readline.createInterface({
      input: process.stdin,
      terminal: false
    });
    rl.on("line", async (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      appendLog(`INBOUND: ${trimmed}`);
      try {
        const req = JSON.parse(trimmed);
        const res = await this.handleRequest(req);
        if (res) {
          const outStr = JSON.stringify(res);
          appendLog(`OUTBOUND: ${outStr}`);
          process.stdout.write(outStr + "\n");
        } else {
          appendLog(`OUTBOUND: (null response for notification)`);
        }
      } catch (err) {
        appendLog(`ERROR: ${err.message}`);
        const errorResponse = {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: `Parse error: ${err.message}`
          }
        };
        process.stdout.write(JSON.stringify(errorResponse) + "\n");
      }
    });
  }
}
export {
  FORENSIC_MCP_TOOLS,
  FileStorageProvider,
  ForensicMCPServer,
  MCPToolsHandler,
  P as PNGBuilder,
  TELEDOM_PROFILE_TOOLS
};
