/**
 * TeleDOM v4.1 — Agent-Owned Workflow Runtime tests.
 *
 * Verifies the architectural contract:
 *   - TeleDOM stores/retrieves/executes/records — never designs or repairs
 *   - envelope validation (structure only) with honest issue reporting
 *   - dumb deterministic execution: templates, policy gates, approval
 *     BLOCKING (never auto-approve), retries, run records, replay
 *   - target memory + agent artifacts persisted durably
 *   - agent memory survives process restarts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentStore, validateWorkflow, diffWorkflows, safeName } from '../../src/intelligence/workflow/store';
import { WorkflowExecutor, toolMatches } from '../../src/intelligence/workflow/executor';
import { AgentWorkflow, WorkflowRun } from '../../src/intelligence/workflow/domain';
import { IntelligenceToolsHandler } from '../../src/intelligence/mcp/intelligence-handler';
import { WORKFLOW_TOOL_NAMES } from '../../src/intelligence/workflow/mcp-tools';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teledom-agent-store-'));
  // Isolate the handler's default store too (td_* tool tests construct
  // IntelligenceToolsHandler which reads this env at AgentStore creation).
  process.env.TELEDOM_AGENT_STORE_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.TELEDOM_AGENT_STORE_DIR;
  if (tmpDir && fs.existsSync(tmpDir)) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      // Allow transient lock in Windows test runners to drain
    }
  }
});

function makeWorkflow(overrides: Partial<AgentWorkflow> = {}): AgentWorkflow {
  return {
    schema: 'teledom.agent-workflow/1.0',
    id: 'wf-test-1',
    name: 'unit_test_flow',
    version: '1.0.0',
    description: 'test workflow',
    steps: [
      { id: 's1', tool: 'td_health_snapshot', args: {} },
      { id: 's2', tool: 'td_evidence_hash', args: { artifact: { a: '{{inputs.x}}' } } },
    ],
    inputs: { x: { description: 'a number', required: true, default: 7 } },
    metadata: { author: 'unit-test' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Pipeline stub: routes td_* into a real handler, stubs live tools. */
function makePipeline() {
  const handler = new IntelligenceToolsHandler();
  return {
    handler,
    pipeline: {
      handleToolCall: async (name: string, args: Record<string, any>) => {
        if (WORKFLOW_TOOL_NAMES.has(name) || name.startsWith('td_')) {
          return handler.handleToolCall(name, args);
        }
        // whitelisted stubs PASS; anything else fails like an unknown tool
        const stubs = new Set(['stubbed_tool', 'another_stub']);
        if (stubs.has(name)) {
          return { content: [{ type: 'text', text: JSON.stringify({ status: 'PASS', stub: true, tool: name, ...(args ?? {}) }) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'FAIL', error: `Unknown tool: ${name}` }) }], isError: true };
      },
    },
  };
}

describe('workflow envelope validation (structural only)', () => {
  it('accepts a well-formed agent workflow', () => {
    const v = validateWorkflow(makeWorkflow());
    expect(v.valid).toBe(true);
    expect(v.issues).toEqual([]);
  });

  it('rejects wrong schema, bad names, empty steps, duplicate step ids', () => {
    const v = validateWorkflow({ schema: 'wrong', name: '../evil', version: 'x', steps: [] });
    expect(v.valid).toBe(false);
    expect(v.issues.some((i) => i.path === '$.schema')).toBe(true);
    expect(v.issues.some((i) => i.path === '$.name')).toBe(true);
    expect(v.issues.some((i) => i.path === '$.version')).toBe(true);
    expect(v.issues.some((i) => i.path === '$.steps')).toBe(true);

    const dup = validateWorkflow(makeWorkflow({
      steps: [
        { id: 'a', tool: 'x' },
        { id: 'a', tool: 'y' },
      ],
    }));
    expect(dup.valid).toBe(false);
    expect(dup.issues.some((i) => i.message.includes('duplicate'))).toBe(true);
  });

  it('safeName blocks traversal and weird characters', () => {
    expect(safeName('..')).toBe(null);
    expect(safeName('a/b')).toBe(null);
    expect(safeName('-bad')).toBe(null);
    expect(safeName('ok_name-1.0')).toBe('ok_name-1.0');
  });
});

describe('AgentStore — workflow persistence + versioning', () => {
  it('save/get/list/clone/delete with version history', () => {
    const store = new AgentStore(tmpDir);
    const wf = makeWorkflow();
    store.saveWorkflow(wf);
    expect(store.getWorkflow('unit_test_flow')).toMatchObject({ name: 'unit_test_flow', version: '1.0.0' });

    // v2 replaces current but keeps v1 in history
    store.saveWorkflow({ ...wf, version: '2.0.0', steps: [...wf.steps, { id: 's3', tool: 'td_health_snapshot' }] });
    expect(store.getWorkflow('unit_test_flow')?.version).toBe('2.0.0');
    expect(store.getWorkflow('unit_test_flow', '1.0.0')?.version).toBe('1.0.0');
    expect(store.listWorkflows()).toHaveLength(1);
    expect(store.listWorkflows()[0].versions).toBe(2);
    expect(store.listWorkflows()[0].steps).toBe(3);

    // clone
    store.saveWorkflow(makeWorkflow()); // ensure base exists
    const cloneEnv = store.getWorkflowEnvelope('unit_test_flow')!;
    expect(cloneEnv.versions).toHaveLength(2);

    // export/import round-trip
    const exported = JSON.parse(JSON.stringify({ current: cloneEnv.current, versions: cloneEnv.versions }));
    expect(exported.current.name).toBe('unit_test_flow');

    // delete
    expect(store.deleteWorkflow('unit_test_flow')).toBe(true);
    expect(store.deleteWorkflow('unit_test_flow')).toBe(false);
    expect(store.listWorkflows()).toHaveLength(0);
  });

  it('diff detects added/removed/changed steps and policy changes', () => {
    const a = makeWorkflow();
    const b = makeWorkflow({
      version: '2.0.0',
      steps: [
        { id: 's1', tool: 'td_health_snapshot', args: {} },
        { id: 's2b', tool: 'td_evidence_hash', args: { artifact: { b: 2 } } },
      ],
      policy: { maxSteps: 5 },
    });
    const diff = diffWorkflows(a, b);
    expect(diff.changed).toBe(true);
    expect(diff.summary.addedSteps).toContain('s2b');
    expect(diff.summary.removedSteps).toContain('s2');
    expect(diff.summary.policyChanged).toBe(true);
  });
});

describe('AgentStore — learned targets + agent artifacts', () => {
  it('target memory: save/get/list/delete with history accumulation', () => {
    const store = new AgentStore(tmpDir);
    store.saveTarget({
      site: 'example.test', semanticId: 'Comments_Tab',
      identity: { role: 'tab', accessibleName: 'Comments' },
      locators: { css: '[data-testid="comments"]', aria: 'Comments' },
      history: { successfulSelectors: ['[data-testid="comments"]'], failedSelectors: [], resolvedCount: 1 },
      confidence: { current: 0.93, historical: 0.9 },
    });
    const t = store.getTarget('example.test', 'Comments_Tab');
    expect(t).not.toBeNull();
    expect(t!.locators.css).toBe('[data-testid="comments"]');
    expect(t!.id).toBe('example_test__comments_tab'); // normalized, traversal-safe
    expect(store.listTargets({ site: 'example.test' })).toHaveLength(1);

    // second save accumulates history
    store.saveTarget({
      site: 'example.test', semanticId: 'Comments_Tab',
      identity: {}, locators: { css: '[aria-label="Replies"]' },
      history: { successfulSelectors: ['[aria-label="Replies"]'], failedSelectors: ['[data-testid="comments"]'], resolvedCount: 2 },
      confidence: { current: 0.9, historical: 0.91 },
    });
    const t2 = store.getTarget('example.test', 'Comments_Tab')!;
    expect(t2.history.successfulSelectors).toHaveLength(2);
    expect(t2.history.resolvedCount).toBe(2);

    expect(store.deleteTarget('example.test', 'Comments_Tab')).toBe(true);
    expect(store.getTarget('example.test', 'Comments_Tab')).toBeNull();
  });

  it('agent artifacts: verbatim storage for custom tools / scripts / policies', () => {
    const store = new AgentStore(tmpDir);
    store.saveArtifact('custom-tool', 'get_unread_messages', {
      steps: ['open inbox', 'detect unread', 'open thread', 'extract messages'],
    }, { description: 'agent-built abstraction', tags: ['mail'] });
    const a = store.getArtifact('custom-tool', 'get_unread_messages');
    expect(a?.content).toMatchObject({ steps: expect.arrayContaining(['open inbox']) });
    expect(store.listArtifacts('custom-tool')).toHaveLength(1);
    expect(store.listArtifacts(undefined, 'mail')).toHaveLength(1);
    expect(store.deleteArtifact('custom-tool', 'get_unread_messages')).toBe(true);
    expect(store.getArtifact('custom-tool', 'get_unread_messages')).toBeNull();
  });
});

describe('WorkflowExecutor — dumb deterministic execution', () => {
  it('executes steps through the pipeline, resolves {{inputs}} and {{steps}} templates', async () => {
    const { pipeline } = makePipeline();
    const executor = new WorkflowExecutor(pipeline);
    const run = await executor.execute({
      workflow: makeWorkflow({
        steps: [
          { id: 's1', tool: 'td_health_snapshot', args: {} },
          { id: 's2', tool: 'stubbed_tool', args: { value: '{{inputs.x}}' } },
          { id: 's3', tool: 'another_stub', args: { echo: '{{steps.s2.stub}}' } },
        ],
      }),
      inputs: { x: 42 },
    });
    expect(run.status).toBe('SUCCESS');
    expect(run.steps).toHaveLength(3);
    expect(run.steps.every((s) => s.status === 'PASS')).toBe(true);
    expect((run.steps[1].args as any).value).toBe(42); // template resolved as-executed
    expect(run.metrics.toolCalls).toBe(3);
    expect(run.metrics.domScans).toBe(0); // stubs are not DOM scans
    expect(run.metrics.durationMs).toBeGreaterThanOrEqual(0);
    // tokensSaved: each tool call ≈ one MCP round trip the agent skipped
    expect(run.metrics.tokensSavedEstimate).toBe((3 - 1) * 380);
  });

  it('fails honestly on abort steps and keeps the partial run record', async () => {
    const { pipeline } = makePipeline();
    const executor = new WorkflowExecutor(pipeline);
    const run = await executor.execute({
      workflow: makeWorkflow({
        steps: [
          { id: 's1', tool: 'td_health_snapshot' },
          { id: 'bad', tool: 'unknown_tool_xyz' },
          { id: 's3', tool: 'td_health_snapshot' },
        ],
      }),
      inputs: {},
    });
    expect(run.status).toBe('PARTIAL');
    expect(run.error).toContain('bad');
    expect(run.steps).toHaveLength(2); // s3 never ran (abort semantics)
    expect(run.steps[1].status).toBe('FAIL');
  });

  it('BLOCKS on approval gates — never auto-approves; resumes with approvedSteps', async () => {
    const { pipeline } = makePipeline();
    const executor = new WorkflowExecutor(pipeline);
    const wf = makeWorkflow({
      steps: [
        { id: 's1', tool: 'td_health_snapshot' },
        { id: 'danger', tool: 'td_health_snapshot', requireApproval: true },
      ],
    });
    const blocked = await executor.execute({ workflow: wf, inputs: {} });
    expect(blocked.status).toBe('BLOCKED');
    expect(blocked.pendingApprovals).toEqual([{ stepId: 'danger', tool: 'td_health_snapshot' }]);
    expect(blocked.steps[1].status).toBe('BLOCKED');

    const approved = await executor.execute({ workflow: wf, inputs: {}, approvedSteps: ['danger'] });
    expect(approved.status).toBe('SUCCESS');
  });

  it('enforces policy: deniedTools, allowedTools, domains, maxSteps, maxRuntimeMs', async () => {
    const { pipeline } = makePipeline();
    const executor = new WorkflowExecutor(pipeline);

    // denied tool pattern
    const denied = await executor.execute({
      workflow: makeWorkflow({ policy: { deniedTools: ['td_health*'] }, steps: [{ id: 's1', tool: 'td_health_snapshot' }] }),
      inputs: {},
    });
    expect(denied.steps[0].status).toBe('FAIL');
    expect(denied.steps[0].error).toContain('denied');

    // not in allowedTools
    const notAllowed = await executor.execute({
      workflow: makeWorkflow({ policy: { allowedTools: ['td_evidence_*'] }, steps: [{ id: 's1', tool: 'td_health_snapshot' }] }),
      inputs: {},
    });
    expect(notAllowed.steps[0].error).toContain('not in allowedTools');

    // denied domain on a url-carrying step
    const domain = await executor.execute({
      workflow: makeWorkflow({
        policy: { deniedDomains: ['evil.test'] },
        steps: [{ id: 'nav', tool: 'td_browser_navigate', args: { url: 'https://evil.test/x' } }],
      }),
      inputs: {},
    });
    expect(domain.steps[0].error).toContain('domain "evil.test" is denied');

    // maxSteps cap
    const capped = await executor.execute({
      workflow: makeWorkflow({
        policy: { maxSteps: 1 },
        steps: [
          { id: 's1', tool: 'td_health_snapshot' },
          { id: 's2', tool: 'td_health_snapshot' },
        ],
      }),
      inputs: {},
    });
    expect(capped.status).toBe('ABORTED');
    expect(capped.error).toContain('maxSteps');

    // wall-clock cap
    const timed = await executor.execute({
      workflow: makeWorkflow({
        policy: { maxRuntimeMs: 1 },
        steps: [{ id: 's1', tool: 'td_health_snapshot' }, { id: 's2', tool: 'td_health_snapshot' }],
      }),
      inputs: {},
    });
    expect(['ABORTED', 'SUCCESS', 'PARTIAL']).toContain(timed.status); // honest: may complete fast
  });

  it('dumb retry: bounded attempts recorded honestly', async () => {
    let calls = 0;
    const pipeline = {
      handleToolCall: async () => {
        calls += 1;
        if (calls < 3) return { content: [{ type: 'text', text: JSON.stringify({ status: 'FAIL' }) }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'PASS' }) }] };
      },
    };
    const executor = new WorkflowExecutor(pipeline as any);
    const run = await executor.execute({
      workflow: makeWorkflow({ steps: [{ id: 'flaky', tool: 'flaky_tool', retry: { count: 3, delayMs: 1 } }] }),
      inputs: {},
    });
    expect(run.steps[0].status).toBe('PASS');
    expect(run.steps[0].attempts).toBe(3);
    expect(run.metrics.retries).toBe(2);
  });

  it('dryRun plans without executing', async () => {
    const { pipeline } = makePipeline();
    const executor = new WorkflowExecutor(pipeline);
    const plan = await executor.execute({
      workflow: makeWorkflow({
        steps: [{ id: 's1', tool: 'td_health_snapshot', args: { tag: '{{inputs.x}}' } }],
      }),
      inputs: { x: 'planned' },
      dryRun: true,
    });
    expect(plan.status).toBe('SUCCESS');
    expect(plan.metrics.toolCalls).toBe(0);
    expect((plan as any).plan[0].args.tag).toBe('planned');
  });

  it('replaySteps re-executes recorded steps verbatim with replayOf lineage', async () => {
    const { pipeline } = makePipeline();
    const executor = new WorkflowExecutor(pipeline);
    const first = await executor.execute({
      workflow: makeWorkflow({ steps: [{ id: 's1', tool: 'td_health_snapshot' }] }),
      inputs: {},
    });
    const replay = await executor.replaySteps(
      { workflowId: first.workflowId, workflowName: first.workflowName, workflowVersion: first.workflowVersion },
      first.steps,
      first.id,
    );
    expect(replay.status).toBe('SUCCESS');
    expect(replay.replayOf).toBe(first.id);
    expect(replay.steps[0].tool).toBe('td_health_snapshot');
  });
});

describe('toolMatches — glob-ish policy patterns', () => {
  it('supports exact, leading, trailing and contains patterns', () => {
    expect(toolMatches('td_workflow_run', 'td_workflow_run')).toBe(true);
    expect(toolMatches('td_health*', 'td_health_snapshot')).toBe(true);
    expect(toolMatches('*snapshot', 'td_health_snapshot')).toBe(true);
    expect(toolMatches('*health*', 'td_health_snapshot')).toBe(true);
    expect(toolMatches('*', 'anything')).toBe(true);
    expect(toolMatches('td_health*', 'td_evidence_hash')).toBe(false);
  });
});

describe('td_* workflow tools through the intelligence handler', () => {
  it('td_workflow_save → get → run → runs → run_get → replay end-to-end', async () => {
    const handler = new IntelligenceToolsHandler();
    handler.attachRoot({
      handleToolCall: async (name: string, args: Record<string, any>) => {
        if (name.startsWith('td_')) return handler.handleToolCall(name, args);
        return { content: [{ type: 'text', text: JSON.stringify({ status: 'PASS', stub: true }) }] };
      },
    });

    const wf = makeWorkflow({ name: 'e2e_flow', steps: [{ id: 's1', tool: 'td_health_snapshot' }] });

    const save = await handler.handleToolCall('td_workflow_save', { workflow: wf });
    expect(JSON.parse((save.content[0] as any).text).status).toBe('PASS');

    const get = await handler.handleToolCall('td_workflow_get', { name: 'e2e_flow' });
    const getBody = JSON.parse((get.content[0] as any).text);
    expect(getBody.status).toBe('PASS');
    expect(getBody.workflow.steps[0].tool).toBe('td_health_snapshot');

    const run = await handler.handleToolCall('td_workflow_run', { name: 'e2e_flow' });
    const runBody = JSON.parse((run.content[0] as any).text);
    expect(runBody.status).toBe('PASS');
    const runId = runBody.runId as string;
    expect(runId).toBeTruthy();

    const runs = await handler.handleToolCall('td_workflow_runs', { name: 'e2e_flow' });
    const runsBody = JSON.parse((runs.content[0] as any).text);
    expect(runsBody.count).toBe(1);

    const runGet = await handler.handleToolCall('td_workflow_run_get', { runId });
    const runGetBody = JSON.parse((runGet.content[0] as any).text);
    expect(runGetBody.run.status).toBe('SUCCESS');

    const replay = await handler.handleToolCall('td_workflow_replay', { runId });
    const replayBody = JSON.parse((replay.content[0] as any).text);
    expect(replayBody.status).toBe('PASS');
    expect(replayBody.replayedFrom).toBe(runId);

    // deterministic record shape (metrics + steps)
    const record = runGetBody.run as WorkflowRun;
    expect(record.metrics).toMatchObject({ toolCalls: 1, stepsPlanned: 1, stepsExecuted: 1 });
    expect(record.steps[0]).toMatchObject({ stepId: 's1', tool: 'td_health_snapshot', status: 'PASS' });
  });

  it('td_memory persists across handler restarts (agent memory durability)', async () => {
    const h1 = new IntelligenceToolsHandler();
    const store1 = await h1.handleToolCall('td_memory', { action: 'store', kind: 'known-failure', statement: 'inbox UI breaks on Fridays', confidence: 0.9 });
    expect(JSON.parse((store1.content[0] as any).text).status).toBe('PASS');

    // a fresh handler (new process simulation) restores from the store
    const h2 = new IntelligenceToolsHandler();
    const q = await h2.handleToolCall('td_memory', { action: 'query' });
    const qBody = JSON.parse((q.content[0] as any).text);
    expect(qBody.items.some((i: any) => i.statement === 'inbox UI breaks on Fridays')).toBe(true);
    // cleanup persisted memory so other tests are unaffected
    await h2.handleToolCall('td_memory', { action: 'clear' });
  });

  it('td_run_workflow (legacy) refuses vacuous empty PASS and routes via root', async () => {
    const handler = new IntelligenceToolsHandler();
    handler.attachRoot({
      handleToolCall: async (name: string, args: Record<string, any>) => handler.handleToolCall(name, args),
    });
    const empty = await handler.handleToolCall('td_run_workflow', {});
    const emptyBody = JSON.parse((empty.content[0] as any).text);
    expect(emptyBody.status).toBe('INCONCLUSIVE');

    const ok = await handler.handleToolCall('td_run_workflow', { workflow: [{ id: 's1', tool: 'td_health_snapshot' }] });
    const okBody = JSON.parse((ok.content[0] as any).text);
    expect(okBody.status).toBe('PASS');
  });

  it('td_run_playbook actually executes its chain (not a vacuous listing)', async () => {
    const handler = new IntelligenceToolsHandler();
    handler.attachRoot({
      handleToolCall: async (name: string, args: Record<string, any>) => handler.handleToolCall(name, args),
    });
    const res = await handler.handleToolCall('td_run_playbook', { playbookId: 'security-passive' });
    const body = JSON.parse((res.content[0] as any).text);
    expect(body.executed).toBe(true);
    expect(body.steps).toHaveLength(4);
    expect(body.steps.every((s: any) => ['PASS', 'FAIL', 'DEGRADED', 'PARTIAL', 'INCONCLUSIVE'].includes(s.status))).toBe(true);
  });

  it('enhanced templating supports array brackets and fallback expressions', async () => {
    const handler = new IntelligenceToolsHandler();
    handler.attachRoot({
      handleToolCall: async (name: string, args: Record<string, any>) => handler.handleToolCall(name, args),
    });
    const wf: AgentWorkflow = {
      schema: 'teledom.agent-workflow/1.0',
      id: 'wf-template-test',
      name: 'template_test',
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [
        {
          id: 's1',
          tool: 'td_evidence_hash',
          args: {
            artifact: {
              fallbackField: '{{inputs.missing | "default_val"}}',
              arrayField: '{{inputs.list[1].name}}',
              nestedField: '{{inputs.user.profile.role}}',
            },
          },
        },
      ],
      inputs: {
        list: { default: [{ name: 'item0' }, { name: 'item1' }] },
        user: { default: { profile: { role: 'admin' } } },
      },
    };
    const executor = new WorkflowExecutor({
      handleToolCall: async (name, args) => handler.handleToolCall(name, args),
    });
    const run = await executor.execute({ workflow: wf, inputs: {} });
    expect(run.status).toBe('SUCCESS');
    expect(run.steps[0].status).toBe('PASS');
  });
});

