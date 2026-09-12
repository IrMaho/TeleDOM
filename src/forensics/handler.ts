/**
 * Forensics capability dispatcher — routes fx_* tool calls, wires the
 * session data, runs the real analyzers and wraps everything in the
 * error contract (§41) + observability (§40).
 */

import { MCPToolCallResult } from '../types/mcp-types';
import { BaseEvent } from '../types/events';
import { FORENSICS_TOOL_NAMES } from './definitions';
import { toErrorEnvelope } from '../devtools/error-contract';
import { unifiedRuntime } from '../devtools/runtime/unified-browser-runtime';
import { ForensicStorageProvider } from '../storage/storage-interface';
import { SessionAccess } from './session-access';

import { EvidenceBuilder, scoreFinding } from './evidence-model';
import {
  correlateDomNetwork, analyzeLayoutShift, buildErrorRootCauseGraph,
  analyzeNetworkDomBindings, buildResourceWaterfall,
} from './correlators/causality';
import { regressionDiff } from './analyzers/regression-diff';
import { decodePng, diffRegions, correlateVisualWithDom } from './analyzers/visual-regression';
import { analyzeVisualRegressionSession } from './analyzers/visual-session';
import { scoreSelectorSurvivability, detectComponentBoundaries, analyzeFrames, analyzeShadowDom } from './analyzers/structure';
import { analyzeCssInfluence, analyzeZIndexOcclusion, analyzeEventListeners, analyzeFontRendering } from './analyzers/live-dom';
import { analyzeA11yDivergence } from './analyzers/a11y-divergence';
import { computePageHealth, planNextActions, crossSignalSearch } from './engine/health-planner-search';
import { smartSnapshot, recommendSnapshotMode, predictChangeImpact, evaluateMutationGuard, transactionJournal, journalFromMutation, journalMutationResult as journalMutationImpl } from './engine/snapshot-impact-journal';
import { buildSessionGraph, generateIncidentReport, buildForensicExport, verifyForensicImport } from './engine/graph-report-portability';
import {
  startInteractionRecording, stopInteractionRecording, recordInteractionStep, replayInteractions, listInteractionRecordings,
  captureFailure, replayFailureScenario, listFailureScenarios, getFailureScenario,
} from './session/interaction-replay';

export class ForensicsToolsHandler {
  private access: SessionAccess;

  constructor(private storage: ForensicStorageProvider) {
    this.access = new SessionAccess(storage);
  }

  knows(toolName: string): boolean {
    return FORENSICS_TOOL_NAMES.has(toolName);
  }

  async handleToolCall(name: string, args: Record<string, any>): Promise<MCPToolCallResult> {
    const started = Date.now();
    try {
      const result = await this.route(name, args || {});
      unifiedRuntime.bus.publish('RUNTIME', 'tool_invocation', { tool: name, ok: true, durationMs: Date.now() - started });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      unifiedRuntime.bus.publish('RUNTIME', 'tool_invocation', { tool: name, ok: false, durationMs: Date.now() - started });
      const envelope = toErrorEnvelope(err);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
    }
  }

  private async route(name: string, args: Record<string, any>): Promise<Record<string, unknown>> {
    switch (name) {
      // ---------------- CAP 01 / 04 / 14 / 15 / 16 (correlators) ----------------
      case 'fx_correlate_dom_network': {
        const sessionId = await this.requireSession(args);
        const engine = await this.access.correlation(sessionId);
        const result = correlateDomNetwork(engine, {
          anchor: args.anchor, eventId: args.eventId, timestamp: args.timestamp,
          windowMs: args.windowMs, limit: args.limit,
        });
        return { sessionId, ...result } as Record<string, unknown>;
      }
      case 'fx_layout_shift_forensics': {
        const sessionId = await this.requireSession(args);
        const engine = await this.access.correlation(sessionId);
        return { sessionId, ...analyzeLayoutShift(engine, { eventId: args.eventId, timestamp: args.timestamp, selector: args.selector, windowMs: args.windowMs }) } as Record<string, unknown>;
      }
      case 'fx_error_root_cause': {
        const sessionId = await this.requireSession(args);
        const engine = await this.access.correlation(sessionId);
        return { sessionId, ...buildErrorRootCauseGraph(engine, { eventId: args.eventId, timestamp: args.timestamp }) } as Record<string, unknown>;
      }
      case 'fx_network_dom_binding': {
        const sessionId = await this.requireSession(args);
        const engine = await this.access.correlation(sessionId);
        return { sessionId, ...analyzeNetworkDomBindings(engine, { windowMs: args.windowMs, minConfidence: args.minConfidence, limit: args.limit }) } as Record<string, unknown>;
      }
      case 'fx_resource_waterfall': {
        const sessionId = await this.requireSession(args);
        const engine = await this.access.correlation(sessionId);
        return { sessionId, ...buildResourceWaterfall(engine, { from: args.from, to: args.to }) } as Record<string, unknown>;
      }

      // ---------------- CAP 02 (regression diff) ----------------
      case 'fx_dom_regression_diff': {
        const sessionId = await this.requireSession(args);
        const t1 = Number(args.t1);
        const t2 = Number(args.t2);
        if (!Number.isFinite(t1) || !Number.isFinite(t2)) throw new Error('INVALID_INPUT: t1 and t2 must be numeric timestamps.');
        if (t2 <= t1) throw new Error('INVALID_INPUT: t2 must be AFTER t1.');
        const before = await this.access.domStateAt(sessionId, t1);
        const after = await this.access.domStateAt(sessionId, t2);
        if (!before || !after) {
          throw new Error(`RESOURCE_EXHAUSTED: could not reconstruct DOM state at t=${!before ? t1 : t2} (no initial snapshot or events for this session).`);
        }
        const result = regressionDiff(before, after, { maxPerDimension: args.maxPerDimension });
        return { sessionId, t1, t2, machine: result.machine, humanReadableReport: result.human };
      }

      // ---------------- CAP 03 (visual regression) ----------------
      case 'fx_visual_regression_forensics': {
        const sessionId = await this.requireSession(args);
        return await analyzeVisualRegressionSession(this.access, sessionId, args);
      }

      // ---------------- CAP 05 / 06 (replay) ----------------
      case 'fx_record_interactions': {
        const mode = String(args.mode || '');
        if (mode === 'start') {
          const rec = startInteractionRecording(args.pageId || 'page_active');
          return { recordingId: rec.recordingId, started: true, pageId: rec.pageId, steps: 0, usage: 'Call with mode=record-step + action + selector for each interaction; mode=stop to finalize; fx_replay_interactions to replay.' };
        }
        if (mode === 'stop') {
          const rec = stopInteractionRecording(String(args.recordingId));
          return { recordingId: rec.recordingId, stopped: true, steps: rec.steps.length, durationMs: (rec.stoppedAt || 0) - rec.startedAt };
        }
        if (mode === 'record-step') {
          if (!args.action || !args.selector) throw new Error('INVALID_INPUT: record-step requires action and selector.');
          const step = await recordInteractionStep(String(args.recordingId), { action: String(args.action), selector: String(args.selector), params: args.params, tabId: args.tabId });
          return { recorded: true, stepId: step.stepId, action: step.action, targetMatched: step.domContext.matchedElements };
        }
        if (mode === 'list') {
          return { recordings: listInteractionRecordings() };
        }
        throw new Error('INVALID_INPUT: mode must be start | stop | record-step | list.');
      }
      case 'fx_replay_interactions': {
        const outcome = await replayInteractions(String(args.recordingId), { tabId: args.tabId, stopOnFailure: args.stopOnFailure, verifySelectorsOnly: args.verifySelectorsOnly });
        return outcome as unknown as Record<string, unknown>;
      }
      case 'fx_failure_replay': {
        const mode = String(args.mode || '');
        if (mode === 'capture') {
          if (!args.failedAction) throw new Error('INVALID_INPUT: capture requires failedAction.');
          const events = args.sessionId ? await this.access.events(String(args.sessionId)).catch(() => [] as any[]) : [];
          const scenario = await captureFailure({
            url: args.url, failedAction: String(args.failedAction), failedSelector: args.failedSelector,
            params: args.params, tabId: args.tabId, events,
          });
          return { failureId: scenario.failureId, captured: true, url: scenario.context.url, selectorCandidates: scenario.selectorCandidates.length, domSubtree: !!scenario.domSubtree, replaySteps: scenario.replay.steps.length };
        }
        if (mode === 'replay') {
          return await replayFailureScenario(String(args.failureId), { tabId: args.tabId, verifyOnly: args.verifyOnly });
        }
        if (mode === 'list') return { failures: listFailureScenarios() };
        if (mode === 'get') return { scenario: getFailureScenario(String(args.failureId)) } as unknown as Record<string, unknown>;
        throw new Error('INVALID_INPUT: mode must be capture | replay | list | get.');
      }

      // ---------------- CAP 07 / 08 / 09 / 10 (structure) ----------------
      case 'fx_selector_survivability': {
        if (!args.selector && !Array.isArray(args.candidateSelectors)) {
          throw new Error('INVALID_INPUT: provide selector or candidateSelectors.');
        }
        const mutationHistory = args.sessionId ? await this.access.events(String(args.sessionId)).catch(() => [] as any[]) : [];
        const scores = scoreSelectorSurvivability({
          selector: args.selector,
          mutationHistory,
          candidateSelectors: args.candidateSelectors,
        });
        return { ranked: scores, method: 'Weighted: DOM stability 25%, uniqueness 20%, semantics 15%, ancestry 15%, framework risk 10%, text 7.5%, position 7.5%.' };
      }
      case 'fx_component_boundaries': {
        const sessionId = await this.requireSession(args);
        const { snapshot, events } = await this.loadStateAndEvents(sessionId, args.timestamp);
        return { sessionId, ...detectComponentBoundaries({ snapshot, events }) } as Record<string, unknown>;
      }
      case 'fx_frame_forensics': {
        const sessionId = await this.requireSession(args);
        const { snapshot, events } = await this.loadStateAndEvents(sessionId, args.timestamp);
        return { sessionId, ...analyzeFrames({ snapshot, events }) } as Record<string, unknown>;
      }
      case 'fx_shadow_dom_forensics': {
        if (args.sessionId) {
          const { snapshot, events } = await this.loadStateAndEvents(String(args.sessionId), args.timestamp);
          const recorded = analyzeShadowDom({ snapshot, events });
          // Live probe of OPEN roots when a live page is available.
          let liveProbe: Record<string, unknown> | null = null;
          if (args.selector || typeof document !== 'undefined') {
            const probeCode = `(function(){
              const hosts = [];
              const root = ${args.selector ? JSON.stringify(args.selector) : 'document'};
              const scope = typeof root === 'string' ? document.querySelector(root) : root;
              if (!scope) return { hosts };
              for (const el of (scope.querySelectorAll ? scope.querySelectorAll('*') : [])) {
                if (el.shadowRoot) {
                  hosts.push({
                    host: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
                    mode: 'open',
                    childCount: el.shadowRoot.childElementCount,
                    slots: Array.from(el.shadowRoot.querySelectorAll('slot')).map(s => s.name || 'default'),
                    stylesheets: el.shadowRoot.querySelectorAll('style, link[rel=stylesheet]').length,
                  });
                }
              }
              return { hosts: hosts.slice(0, 50) };
            })()`;
            liveProbe = await runInPageSafe(probeCode, args.tabId);
          }
          return { sessionId: String(args.sessionId), ...recorded, liveOpenRoots: liveProbe } as Record<string, unknown>;
        }
        // live-only mode
        const probeCode = `(function(){
          const hosts = [];
          for (const el of document.querySelectorAll('*')) {
            if (el.shadowRoot) hosts.push({ host: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''), mode: 'open', childCount: el.shadowRoot.childElementCount, slots: Array.from(el.shadowRoot.querySelectorAll('slot')).map(s => s.name || 'default') });
          }
          return { hosts: hosts.slice(0, 50) };
        })()`;
        const live = await runInPageSafe(probeCode, args.tabId);
        return { liveOpenRoots: live, note: 'Live shadow-root probe. Closed shadow roots are not accessible by design (browser security boundary) — recorded flags only, never claimed as inspectable.' };
      }

      // ---------------- CAP 11 / 12 / 13 / 17 (live DOM) ----------------
      case 'fx_css_influence': {
        if (!args.selector) throw new Error('INVALID_INPUT: selector is required.');
        return await analyzeCssInfluence({ selector: String(args.selector), group: args.group, tabId: args.tabId });
      }
      case 'fx_zindex_occlusion': {
        if (!args.selector) throw new Error('INVALID_INPUT: selector is required.');
        return await analyzeZIndexOcclusion({ selector: String(args.selector), tabId: args.tabId });
      }
      case 'fx_event_listeners': {
        return await analyzeEventListeners({ selector: args.selector, tabId: args.tabId });
      }
      case 'fx_font_forensics': {
        return await analyzeFontRendering({ tabId: args.tabId });
      }

      // ---------------- CAP 18 (a11y) ----------------
      case 'fx_a11y_divergence': {
        const sessionId = await this.requireSession(args);
        const { snapshot } = await this.loadStateAndEvents(sessionId, args.timestamp);
        return { sessionId, ...analyzeA11yDivergence({ snapshot }) } as Record<string, unknown>;
      }

      // ---------------- CAP 19 / 20 / 22 (engine) ----------------
      case 'fx_page_health': {
        const sessionId = await this.requireSession(args);
        const events = await this.access.events(sessionId);
        const { snapshot } = await this.loadStateAndEvents(sessionId);
        return { sessionId, ...computePageHealth({ events, snapshot, failedInteractions: args.failedInteractions }) } as Record<string, unknown>;
      }
      case 'fx_exploration_planner': {
        const sessionId = await this.requireSession(args);
        const events = await this.access.events(sessionId);
        return { sessionId, ...planNextActions({ symptom: args.symptom, events }) } as Record<string, unknown>;
      }
      case 'fx_cross_signal_search': {
        const sessionId = await this.requireSession(args);
        const events = await this.access.events(sessionId);
        return { sessionId, ...crossSignalSearch({ query: String(args.query || ''), events, limit: args.limit }) } as Record<string, unknown>;
      }

      // ---------------- CAP 21 / 25 / 26 / 27 (engine) ----------------
      case 'fx_smart_snapshot': {
        const sessionId = await this.requireSession(args);
        const mode: any = args.mode || (args.question ? recommendSnapshotMode(String(args.question)) : 'SEMANTIC');
        const { snapshot } = await this.loadStateAndEvents(sessionId, args.timestamp);
        if (!snapshot) throw new Error('RESOURCE_EXHAUSTED: no DOM state reconstructable for this session.');
        const recommended = args.question ? recommendSnapshotMode(String(args.question)) : mode;
        return { sessionId, recommendedMode: recommended, ...smartSnapshot({ snapshot, mode }) };
      }
      case 'fx_impact_prediction': {
        if (!args.operation || !args.selector) throw new Error('INVALID_INPUT: operation and selector are required.');
        let snapshot: any = null;
        let storedSelectors: string[] = [];
        if (args.sessionId) {
          const state = await this.loadStateAndEvents(String(args.sessionId));
          snapshot = state.snapshot;
          const annotations = await this.storage.getAnnotations(String(args.sessionId)).catch(() => []);
          storedSelectors = annotations.map((a: any) => a.target?.selector || a.selector).filter(Boolean);
        } else if (typeof document !== 'undefined') {
          // live/simulation document state via snapshot engine
          const { snapshot: live } = await this.captureLiveSnapshot();
          snapshot = live;
        }
        const prediction = predictChangeImpact({ operation: String(args.operation), selector: String(args.selector), snapshot, storedSelectors });
        return { prediction, previewIntegration: 'Call preview_dom_mutation for the engine-level preview; this prediction adds selector/listener/a11y/form dimensions (CAP 25).' };
      }
      case 'fx_safe_mutation_guard': {
        if (!args.operation || !args.selector) throw new Error('INVALID_INPUT: operation and selector are required.');
        let snapshot: any = null;
        let storedSelectors: string[] = [];
        if (args.sessionId) {
          const state = await this.loadStateAndEvents(String(args.sessionId));
          snapshot = state.snapshot;
          const annotations = await this.storage.getAnnotations(String(args.sessionId)).catch(() => []);
          storedSelectors = annotations.map((a: any) => a.target?.selector || a.selector).filter(Boolean);
        } else if (typeof document !== 'undefined') {
          const { snapshot: live } = await this.captureLiveSnapshot();
          snapshot = live;
        }
        const prediction = predictChangeImpact({ operation: String(args.operation), selector: String(args.selector), snapshot, storedSelectors });
        const guard = evaluateMutationGuard({ operation: String(args.operation), selector: String(args.selector), prediction });
        return { guard, prediction };
      }
      case 'fx_transaction_journal': {
        const query = transactionJournal.query({ transactionId: args.transactionId, operation: args.operation, since: args.since, limit: args.limit });
        return { ...query, stats: transactionJournal.stats() };
      }

      // ---------------- CAP 23 / 24 / 28 / 29 / 30 ----------------
      case 'fx_forensic_export': {
        const sessionId = await this.requireSession(args);
        const session = await this.storage.getSession(sessionId);
        const events = await this.access.events(sessionId);
        const { snapshot } = await this.loadStateAndEvents(sessionId);
        const findings: any[] = [];
        // derive findings from the correlators for export completeness
        const engine = await this.access.correlation(sessionId);
        try {
          const causality = correlateDomNetwork(engine, {});
          for (const c of causality.candidates.slice(0, 3)) {
            findings.push(new EvidenceBuilder(c.chain.join(' → '), 'CAP 01 correlation during export')
              .add('MUTATION_RECORD', c.afterMutation?.summary || 'mutation')
              .add('NETWORK_CORRELATION', c.request?.summary || 'request').build());
          }
        } catch { /* empty sessions export findings as-is */ }
        let health: any;
        if (args.includeHealth !== false) {
          health = computePageHealth({ events, snapshot });
        }
        let incidentReport: any;
        if (args.includeIncidentReport) {
          incidentReport = generateIncidentReport({ session: session!, events, health, findings });
        }
        const bundle = buildForensicExport({ session: session!, events, findings, health, incidentReport });
        return { bundle, bundleJson: JSON.stringify(bundle), sizeBytes: JSON.stringify(bundle).length };
      }
      case 'fx_forensic_import': {
        if (!args.bundleJson) throw new Error('INVALID_INPUT: bundleJson is required.');
        let parsed: unknown;
        try { parsed = JSON.parse(String(args.bundleJson)); } catch (err: any) {
          throw new Error(`INVALID_INPUT: bundleJson is not valid JSON (${err.message}).`);
        }
        const verification = verifyForensicImport(parsed);
        if (!verification.valid) {
          return { imported: false, valid: false, errors: verification.errors, note: 'Bundle rejected — see errors. Historical evidence integrity is enforced.' };
        }
        const bundle = verification.bundle!;
        if (args.importAsSession !== false) {
          // register a queryable HISTORICAL session (clearly marked)
          const historicalSession: any = {
            ...bundle.session,
            id: `${bundle.session.id}_historical_${Date.now().toString(36)}`,
            name: `${bundle.session.name || bundle.session.id} (IMPORTED INVESTIGATION)`,
            status: 'stopped',
            importedInvestigation: true,
            importSource: 'fx_forensic_import',
            importedAt: Date.now(),
          };
          await this.storage.saveSession(historicalSession);
          const importableEvents = bundle.timeline.map((t, i) => ({
            id: `imp_${i + 1}`,
            sessionId: historicalSession.id,
            timestamp: t.timestamp,
            sequence: i + 2,
            wallClockTime: (bundle.session.startTime || 0) + t.timestamp,
            type: t.type,
            category: t.domain,
            source: 'DEVTOOLS',
            targetSelector: undefined,
            payload: { summary: t.summary, historical: true },
          })) as unknown as BaseEvent[];
          if (importableEvents.length > 0) await this.storage.appendEvents(historicalSession.id, importableEvents);
          return { imported: true, valid: true, historicalSessionId: historicalSession.id, timelineEvents: importableEvents.length, findings: bundle.findings.length, note: 'Installed as HISTORICAL evidence (importedInvestigation: true). Imported data is never live browser state (CAP 24).' };
        }
        return { imported: true, valid: true, historicalSessionId: null, note: 'Bundle verified only (importAsSession=false).' };
      }
      case 'fx_session_graph': {
        const sessionId = await this.requireSession(args);
        const session = await this.storage.getSession(sessionId);
        const events = await this.access.events(sessionId);
        const livePages = unifiedRuntime.identity.list().map(p => ({ pageId: p.pageId, url: p.url, tabId: p.extensionTabId, title: p.title, frames: p.frames.length, navigations: p.navigations.length }));
        return { sessionId, ...buildSessionGraph({ session: session!, events, livePages }) } as Record<string, unknown>;
      }
      case 'fx_evidence_scoring': {
        if (!args.conclusion || !Array.isArray(args.supporting)) {
          throw new Error('INVALID_INPUT: conclusion and supporting[] are required.');
        }
        const finding = scoreFinding(String(args.conclusion), args.supporting, args.contradicting || []);
        return { finding, methodology: 'Noisy-OR over evidence weights + source diversity bonus − contradiction penalty. Capped [0.05, 0.98]; single-evidence findings cap at 0.75.' };
      }
      case 'fx_incident_report': {
        const sessionId = await this.requireSession(args);
        const session = await this.storage.getSession(sessionId);
        const events = await this.access.events(sessionId);
        const { snapshot } = await this.loadStateAndEvents(sessionId);
        const health = computePageHealth({ events, snapshot });
        const engine = await this.access.correlation(sessionId);
        const rootCauseGraph = buildErrorRootCauseGraph(engine, {});
        const rootCause = args.rootCauseHint
          ? { conclusion: String(args.rootCauseHint), confidence: 0.5, band: 'MEDIUM' }
          : (rootCauseGraph.rankedRootCauses[0]
            ? { conclusion: rootCauseGraph.rankedRootCauses[0].label, confidence: rootCauseGraph.rankedRootCauses[0].confidence, band: rootCauseGraph.rankedRootCauses[0].band }
            : null);
        const findings: any[] = rootCauseGraph.rankedRootCauses.map((rc: any) => scoreFinding(rc.label, [
          { source: 'CONSOLE_EVIDENCE', description: rootCauseGraph.error.message },
          { source: 'INFERRED', description: `Ranked root cause from CAP 14 graph (${rc.evidenceCount} evidence items)` },
        ]));
        const report = generateIncidentReport({ session: session!, events, health, rootCause: rootCause || undefined, findings, detectedIssue: args.detectedIssue });
        return { report, json: report, markdown: report.markdown };
      }

      default:
        throw new Error(`UNSUPPORTED_OPERATION: unknown forensics tool '${name}'.`);
    }
  }

  // ---------------- helpers ----------------

  private async requireSession(args: Record<string, any>): Promise<string> {
    if (!args.sessionId) throw new Error('INVALID_INPUT: sessionId is required (discover with list_sessions).');
    await this.access.requireSession(String(args.sessionId));
    return String(args.sessionId);
  }

  /** Load the DOM state at a timestamp (or the latest available) + events. */
  private async loadStateAndEvents(sessionId: string, timestamp?: number): Promise<{ snapshot: any; events: any[] }> {
    const events = await this.access.events(sessionId);
    let snapshot: any = null;
    if (timestamp !== undefined) {
      snapshot = await this.access.domStateAt(sessionId, Number(timestamp));
    }
    if (!snapshot) {
      const latest = await this.access.latestSnapshotBefore(sessionId, Infinity);
      snapshot = latest?.snapshot || null;
    }
    if (!snapshot && events.length > 0) {
      const lastTs = Math.max(...events.map(e => e.timestamp));
      snapshot = await this.access.domStateAt(sessionId, lastTs).catch(() => null);
    }
    return { snapshot, events };
  }

  private async captureLiveSnapshot(): Promise<{ snapshot: any }> {
    try {
      const res = await unifiedRuntime.bridgeCommand('LIVE_DOM_SNAPSHOT', { format: 'json' });
      return { snapshot: res };
    } catch (err: any) {
      console.warn(`[ForensicsHandler] Could not capture live snapshot: ${err?.message || err}`);
      return { snapshot: null };
    }
  }
}

async function runInPageSafe(code: string, tabId?: number): Promise<Record<string, unknown> | null> {
  try {
    const { runInPage } = await import('../devtools/capabilities/interaction-core');
    return await runInPage(code, tabId);
  } catch (err: any) {
    console.warn(`[ForensicsHandler] runInPageSafe failed for tab ${tabId}: ${err?.message || err}`);
    return null;
  }
}

/** Re-exported for handler wiring (mutation flow journaling, CAP 27). */
export { journalMutationImpl as journalMutationResult };
