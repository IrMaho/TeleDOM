/**
 * §44 Agent Tool Discovery — tool groups + per-tool metadata.
 *
 * Every tool communicates: purpose, required context, accepted input,
 * output, side effects, failure conditions, and recovery strategy.
 * Related tools are exposed as discoverable groups so agents never have
 * to guess which tool to use.
 */

export interface ToolDiscoveryInfo {
  tool: string;
  group: string;
  purpose: string;
  requiredContext: string;
  input: string;
  output: string;
  sideEffects: string;
  failureConditions: string[];
  recoveryStrategy: string;
}

export interface ToolGroupInfo {
  group: string;
  description: string;
  tools: string[];
}

export const TOOL_GROUPS: ToolGroupInfo[] = [
  {
    group: 'session-forensics',
    description: 'Historical forensic session management and analysis (recorded sessions, timelines, DOM states, diffs, lifecycle tracing).',
    tools: ['list_sessions', 'get_session', 'export_session', 'import_session', 'delete_session', 'get_timeline', 'get_events', 'get_events_around', 'get_dom_state', 'get_dom_node', 'get_dom_subtree', 'diff_dom', 'trace_element', 'find_disappearing_elements', 'why_did_element_disappear', 'get_diagnostics', 'get_network_events', 'get_screenshots', 'annotate_session', 'get_annotations', 'get_recording_health'],
  },
  {
    group: 'inspection',
    description: 'Live page and element inspection: page metadata, element deep-info, visual state, DOM snapshots and analyzers.',
    // v4.1 fix (E-14): removed phantom `detect_semantic_elements` (never
    // existed in FORENSIC_MCP_TOOLS — the catalog advertised an uncallable tool).
    tools: ['inspect_live_page', 'inspect_live_element', 'get_element_visual_state', 'get_live_dom_snapshot', 'get_live_dom_subtree', 'get_tab_console_logs', 'get_tab_network_requests', 'get_element_ancestry', 'get_element_accessibility', 'get_computed_style', 'analyze_dom', 'search_dom', 'get_page_blueprint', 'get_element_fingerprint'],
  },
  {
    group: 'browser-primitives',
    description: 'v4.1 — Clean, stable agent-facing browser verbs (td_browser_*/td_dom_*/td_target_*/td_action_*): navigate, observe, query, extract, find/verify/describe targets, interact, wait, screenshot + escape hatches (script, network, console).',
    tools: ['td_browser_navigate', 'td_browser_back', 'td_browser_forward', 'td_browser_refresh', 'td_dom_inspect', 'td_dom_query', 'td_dom_extract', 'td_dom_snapshot', 'td_target_find', 'td_target_check', 'td_target_describe', 'td_action_click', 'td_action_type', 'td_action_select', 'td_action_hover', 'td_action_press', 'td_action_scroll', 'td_wait', 'td_screenshot', 'td_execute_script', 'td_network_inspect', 'td_console_read'],
  },
  {
    group: 'workflow-runtime',
    description: 'v4.1 — Agent-owned workflow persistence (save/get/list/update/delete/clone/diff/export/import) + DUMB execution with policy gates + deterministic execution records + verbatim replay. TeleDOM stores and executes; the agent designs and repairs.',
    tools: ['td_workflow_save', 'td_workflow_get', 'td_workflow_list', 'td_workflow_update', 'td_workflow_delete', 'td_workflow_clone', 'td_workflow_diff', 'td_workflow_export', 'td_workflow_import', 'td_workflow_validate', 'td_workflow_run', 'td_workflow_runs', 'td_workflow_run_get', 'td_workflow_replay'],
  },
  {
    group: 'agent-owned-tooling',
    description: 'v4.1 — Learned targets (target memory: skip DOM re-analysis on every run) + agent artifact store (custom tools, scripts, policies, memories — stored verbatim, never interpreted).',
    tools: ['td_target_memory_save', 'td_target_memory_get', 'td_target_memory_list', 'td_target_memory_delete', 'td_agent_artifact_save', 'td_agent_artifact_get', 'td_agent_artifact_list', 'td_agent_artifact_delete'],
  },
  {
    group: 'targeting',
    description: 'Element targeting resilience: TARGET generation, selector candidates with confidence, recovery, diagnostics.',
    tools: ['generate_element_target', 'recover_selector', 'diagnose_selector_failure'],
  },
  {
    group: 'interaction',
    description: 'Page interaction: clicks, typing, hover, focus, keyboard, drag-and-drop, checkboxes, selects, waits.',
    tools: ['interact_with_element', 'click_element', 'type_text', 'hover_element', 'focus_element', 'blur_element', 'press_keyboard_shortcut', 'scroll_to_element', 'scroll_page', 'drag_and_drop', 'set_input_checked', 'select_option', 'wait_for_condition', 'wait_for_dom_stable', 'set_interaction_profile', 'get_interaction_profile'],
  },
  {
    group: 'tabs-browser',
    description: 'Tab lifecycle and browser control: open/close/switch tabs, extension management, navigation, reload.',
    tools: ['list_tabs', 'focus_tab', 'reload_tab', 'close_tab', 'open_tab', 'list_extensions', 'set_extension_enabled', 'toggle_extension', 'reload_extension', 'compare_extension_states', 'get_browser_session'],
  },
  {
    group: 'selection-capture',
    description: 'Interactive element selection (Ctrl+Shift+Click / picker) and element observation.',
    tools: ['get_selected_element', 'start_element_picker', 'stop_element_picker', 'start_element_observation', 'stop_element_observation'],
  },
  {
    group: 'viewport-responsive',
    description: 'Viewport control and responsive testing: resize, presets, device emulation, multi-viewport workflows.',
    tools: ['resize_viewport', 'reset_viewport', 'get_viewport_state', 'run_responsive_test', 'emulate_device'],
  },
  {
    group: 'javascript',
    description: 'Observable JavaScript execution with explicit outcome states and change capture.',
    tools: ['execute_javascript', 'execute_js_and_capture_changes'],
  },
  {
    group: 'dom-mutation',
    description: 'First-class DOM mutation engine: operations with diff, transactions, undo/redo, history, preview.',
    tools: ['mutate_dom', 'mutate_dom_transaction', 'undo_dom_mutation', 'redo_dom_mutation', 'get_mutation_history', 'preview_dom_mutation', 'preview_command', 'clone_dom_subtree'],
  },
  {
    group: 'command-sequences',
    description: 'Command sequences, recording, replay, import/export of deterministic command data.',
    tools: ['execute_pipeline', 'execute_command_sequence', 'record_commands_start', 'record_commands_stop', 'list_command_recordings', 'get_command_recording', 'replay_command_recording', 'export_command_recording', 'import_command_recording', 'delete_command_recording'],
  },
  {
    group: 'page-state',
    description: 'Page state snapshots and time-travel comparison.',
    tools: ['capture_page_state', 'compare_page_states', 'list_page_states', 'get_action_timeline', 'get_operation_trace'],
  },
  {
    group: 'projects-knowledge',
    description: 'Project folders, region capture/annotation, relationship graphs, reconstruction specs, agent packages.',
    tools: ['create_page_project', 'list_projects', 'get_project', 'delete_project', 'capture_page_region', 'annotate_element', 'list_region_annotations', 'get_region_annotation', 'update_region_annotation', 'delete_region_annotation', 'get_region_relationship_graph', 'generate_reconstruction_spec', 'export_agent_package', 'import_project'],
  },
  {
    group: 'screenshots',
    description: 'Visual capture: page and element screenshots with geometry metadata.',
    tools: ['capture_page_screenshot', 'capture_element_screenshot'],
  },
  {
    group: 'security-privacy',
    description: 'Capture redaction configuration and exclusion rules.',
    tools: ['get_redaction_rules', 'set_redaction_rules'],
  },
  {
    group: 'discovery',
    description: 'Meta-tools: tool catalog and group discovery for agent self-orientation.',
    tools: ['get_tool_catalog', 'get_tool_groups'],
  },
  // ---- §8 Chrome DevTools MCP capability families (dt_ namespace) ----
  {
    group: 'devtools-input',
    description: 'Chrome DevTools MCP input automation: uid/selector-addressed clicks, drags, fills, form batching, dialogs, keys, uploads (CAP §8 input family).',
    tools: ['dt_click', 'dt_click_at', 'dt_drag', 'dt_fill', 'dt_fill_form', 'dt_handle_dialog', 'dt_hover', 'dt_press_key', 'dt_type_text', 'dt_upload_file'],
  },
  {
    group: 'devtools-navigation',
    description: 'Chrome DevTools MCP page management: list/select/new/close pages, navigation, history, condition waits.',
    tools: ['dt_list_pages', 'dt_select_page', 'dt_new_page', 'dt_close_page', 'dt_navigate_page', 'dt_history_navigation', 'dt_wait_for'],
  },
  {
    group: 'devtools-emulation',
    description: 'Device/page emulation: viewport, DPR, UA, CPU throttling, network conditions, geolocation, color scheme, headers, resize.',
    tools: ['dt_emulate', 'dt_resize_page'],
  },
  {
    group: 'devtools-performance',
    description: 'Performance tracing via the CDP gateway (chrome.debugger): trace lifecycle, Web Vitals (LCP/INP/CLS/FCP), long tasks, layout shifts, phase analysis.',
    tools: ['dt_performance_start_trace', 'dt_performance_stop_trace', 'dt_performance_analyze_insight'],
  },
  {
    group: 'devtools-network',
    description: 'Unified network log: request listing with filters/pagination and full request inspection (shares capture with MCPDOM network monitoring).',
    tools: ['dt_list_network_requests', 'dt_get_network_request'],
  },
  {
    group: 'devtools-debugging',
    description: 'Debugging: script evaluation, console messages/history, screenshots, semantic page snapshots (uid-addressable), screencast (experimental), Lighthouse (experimental).',
    tools: ['dt_evaluate_script', 'dt_list_console_messages', 'dt_get_console_message', 'dt_take_screenshot', 'dt_take_snapshot', 'dt_screencast_start', 'dt_screencast_stop', 'dt_lighthouse_audit'],
  },
  {
    group: 'devtools-memory',
    description: 'V8 heap snapshot lifecycle and analysis: capture, summary, class nodes, edges, retainers, retaining paths, dominators, duplicate strings, object details, queries, snapshot diffing.',
    tools: ['dt_take_heapsnapshot', 'dt_close_heapsnapshot', 'dt_heapsnapshot_summary', 'dt_heapsnapshot_details', 'dt_heapsnapshot_class_nodes', 'dt_heapsnapshot_edges', 'dt_heapsnapshot_retainers', 'dt_heapsnapshot_retaining_paths', 'dt_heapsnapshot_dominators', 'dt_heapsnapshot_duplicate_strings', 'dt_heapsnapshot_object_details', 'dt_query_heapsnapshot_objects', 'dt_compare_heapsnapshots'],
  },
  {
    group: 'devtools-extensions',
    description: 'Browser extension management (chrome.management): install detection, listing, reload, action trigger, uninstall (soft).',
    tools: ['dt_install_extension', 'dt_list_extensions', 'dt_reload_extension', 'dt_trigger_extension_action', 'dt_uninstall_extension'],
  },
  {
    group: 'devtools-third-party',
    description: 'Third-party developer tools exposed by the page (window.__devtools_3p_tools): discovery and validated execution (experimental).',
    tools: ['dt_list_3p_developer_tools', 'dt_execute_3p_developer_tool'],
  },
  {
    group: 'devtools-webmcp',
    description: 'WebMCP tools exposed by the page (navigator.webMCP draft): discovery and validated remote execution.',
    tools: ['dt_list_webmcp_tools', 'dt_execute_webmcp_tool'],
  },
  // ---- §17 the 30 MCPDOM-native advanced forensic capabilities (fx_ namespace) ----
  {
    group: 'advanced-forensics',
    description: 'The 30 MCPDOM-native advanced forensic capabilities: cross-signal causal correlation, regression/visual diffs, layout shift evidence, replay, selector survivability, component boundaries, frame/shadow DOM, CSS/z-index/listener/font analysis, a11y divergence, health scoring, planning, smart snapshots, cross-signal search, session portability, impact prediction, mutation guard, transaction journal, session graph, evidence scoring and incident reporting.',
    tools: [
      'fx_correlate_dom_network', 'fx_dom_regression_diff', 'fx_visual_regression_forensics', 'fx_layout_shift_forensics',
      'fx_record_interactions', 'fx_replay_interactions', 'fx_failure_replay', 'fx_selector_survivability',
      'fx_component_boundaries', 'fx_frame_forensics', 'fx_shadow_dom_forensics', 'fx_css_influence',
      'fx_zindex_occlusion', 'fx_event_listeners', 'fx_error_root_cause', 'fx_network_dom_binding',
      'fx_resource_waterfall', 'fx_font_forensics', 'fx_a11y_divergence', 'fx_page_health',
      'fx_exploration_planner', 'fx_smart_snapshot', 'fx_cross_signal_search', 'fx_forensic_export',
      'fx_forensic_import', 'fx_impact_prediction', 'fx_safe_mutation_guard', 'fx_transaction_journal',
      'fx_session_graph', 'fx_evidence_scoring', 'fx_incident_report',
    ],
  },
];

const FAILURE: Record<string, string[]> = {
  live: ['EXTENSION_UNAVAILABLE (no browser connected)', 'TARGET_NOT_FOUND', 'TARGET_STALE (element removed)', 'SCRIPT_TIMEOUT', 'DOM_MUTATION_FAILED'],
  stored: ['SESSION_NOT_FOUND', 'invalid arguments'],
};

export function buildToolCatalog(): ToolDiscoveryInfo[] {
  const catalog: ToolDiscoveryInfo[] = [];
  for (const g of TOOL_GROUPS) {
    for (const tool of g.tools) {
      const isAnalysis = g.group === 'session-forensics' || g.group === 'page-state' || g.group === 'discovery' || g.group === 'security-privacy';
      catalog.push({
        tool,
        group: g.group,
        purpose: `See tool description (tools/list) — group: ${g.description}`,
        requiredContext: isAnalysis
          ? g.group === 'session-forensics' ? 'Recorded session id where applicable' : 'None (read-only meta information)'
          : 'Live browser connection or Node simulation context',
        input: 'See inputSchema in tools/list',
        output: 'See tool description in tools/list',
        sideEffects: ['dom-mutation', 'interaction', 'tabs-browser', 'javascript', 'command-sequences', 'projects-knowledge', 'viewport-responsive'].includes(g.group)
          ? 'May modify page state, browser state, or write project files (all DOM mutations are undoable)'
          : 'None (read-only)',
        failureConditions: isAnalysis ? FAILURE.stored : FAILURE.live,
        recoveryStrategy: g.group === 'tabs-browser'
          ? 'Ensure the extension is connected (bridge on 127.0.0.1:3847); in the Node simulation context these tools return deterministic simulated state.'
          : g.group === 'dom-mutation'
          ? 'Call undo_dom_mutation to revert; use preview_dom_mutation before destructive operations; wrap multi-step changes in mutate_dom_transaction.'
          : g.group === 'targeting'
          ? 'Call generate_element_target for a fresh TARGET, then recover_selector with the old snapshot if it drifts.'
          : 'Retry after wait_for_condition; inspect get_operation_trace for correlated errors.',
      });
    }
  }
  return catalog;
}

export function findGroupOfTool(toolName: string): ToolGroupInfo | undefined {
  return TOOL_GROUPS.find((g) => g.tools.includes(toolName));
}

export type TeledomProfileName = 'minimal' | 'core' | 'forensics' | 'full';

export const TELEDOM_PROFILE_TOOLS: Record<string, string[] | null> = {
  // Minimal profile: strictly essential browser actions (~22 tools, ~2.5k tokens)
  minimal: [
    'td_browser_navigate', 'td_browser_back', 'td_browser_forward', 'td_browser_refresh',
    'td_dom_inspect', 'td_dom_query', 'td_dom_extract', 'td_dom_snapshot',
    'td_target_find', 'td_target_check',
    'td_action_click', 'td_action_type', 'td_action_select', 'td_action_press', 'td_action_scroll',
    'td_wait', 'td_screenshot', 'td_execute_script',
    'list_tabs', 'focus_tab', 'close_tab', 'open_tab',
  ],
  // Core profile: browser primitives + workflow runtime + target memory (~44 tools, ~4.8k tokens)
  core: [
    'td_browser_navigate', 'td_browser_back', 'td_browser_forward', 'td_browser_refresh',
    'td_dom_inspect', 'td_dom_query', 'td_dom_extract', 'td_dom_snapshot',
    'td_target_find', 'td_target_check', 'td_target_describe',
    'td_action_click', 'td_action_type', 'td_action_select', 'td_action_hover', 'td_action_press', 'td_action_scroll',
    'td_wait', 'td_screenshot', 'td_execute_script', 'td_network_inspect', 'td_console_read',
    'td_workflow_save', 'td_workflow_get', 'td_workflow_list', 'td_workflow_update', 'td_workflow_delete',
    'td_workflow_validate', 'td_workflow_run', 'td_workflow_runs', 'td_workflow_replay',
    'td_target_memory_save', 'td_target_memory_get', 'td_target_memory_list', 'td_target_memory_delete',
    'list_tabs', 'focus_tab', 'reload_tab', 'close_tab', 'open_tab',
    'inspect_live_page', 'inspect_live_element',
  ],
  // Forensics profile: historical forensics + diffs + causality + live inspection (~50 tools)
  forensics: [
    'list_sessions', 'get_session', 'export_session', 'import_session', 'delete_session',
    'get_timeline', 'get_events', 'get_events_around', 'get_dom_state', 'get_dom_node', 'get_dom_subtree',
    'diff_dom', 'trace_element', 'find_disappearing_elements', 'why_did_element_disappear',
    'get_diagnostics', 'get_network_events', 'get_screenshots',
    'td_browser_navigate', 'td_dom_inspect', 'td_dom_query', 'td_dom_extract', 'td_screenshot',
    'td_action_click', 'td_action_type', 'td_workflow_run', 'list_tabs', 'focus_tab',
  ],
  // Full profile: all 350 tools (null means no filtering)
  full: null,
};
