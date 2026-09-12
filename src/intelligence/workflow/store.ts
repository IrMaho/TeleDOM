/**
 * TeleDOM v4.1 — Agent Store (persistence primitives).
 *
 * Durable, file-backed storage for AGENT-OWNED artifacts:
 *   .teledom_agent/
 *     workflows/<name>.json   — envelope { current, versions[] }
 *     runs/<runId>.json       — deterministic execution records
 *     targets/<id>.json       — learned targets (target memory)
 *     artifacts/<kind>/<name>.json — custom tools / scripts / policies / memories
 *     memory.json             — platform agent-memory snapshot
 *
 * Design rules (mirrors recording-storage.ts discipline):
 *   - atomic writes (tmp file + rename) — no half-written artifacts
 *   - bounded run history (prune oldest, keep RUN_KEEP_LIMIT)
 *   - structural validation ONLY (envelope); semantics belong to the agent
 *   - corruption is detected and reported, never silently overwritten
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  AgentArtifact,
  AgentArtifactKind,
  AgentWorkflow,
  LearnedTarget,
  WorkflowEnvelope,
  WorkflowRun,
  WorkflowValidation,
  WorkflowValidationIssue,
  WORKFLOW_SCHEMA,
} from './domain';

const RUN_KEEP_LIMIT = 500;
const MAX_RUNS_PER_WORKFLOW = 100;

export function safeName(name: string): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 128) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(trimmed)) return null;
  if (trimmed.includes('..')) return null;
  return trimmed;
}

/** Structural envelope validation — NEVER semantic interpretation. */
export function validateWorkflow(input: unknown): WorkflowValidation {
  const issues: WorkflowValidationIssue[] = [];
  const w = input as Partial<AgentWorkflow>;
  if (!input || typeof input !== 'object') {
    return { valid: false, issues: [{ path: '$', message: 'workflow must be an object' }] };
  }
  if (w.schema !== WORKFLOW_SCHEMA) {
    issues.push({ path: '$.schema', message: `must equal "${WORKFLOW_SCHEMA}" (got ${JSON.stringify(w.schema)})` });
  }
  if (typeof w.name !== 'string' || !safeName(w.name)) {
    issues.push({ path: '$.name', message: 'required, 1-128 chars, [A-Za-z0-9._-], no leading dash' });
  }
  if (typeof w.version !== 'string' || !/^\d+\.\d+\.\d+/.test(w.version)) {
    issues.push({ path: '$.version', message: 'required semver-ish string, e.g. "1.0.0"' });
  }
  if (w.steps == null || !Array.isArray(w.steps)) {
    issues.push({ path: '$.steps', message: 'required array of steps' });
  } else {
    if (w.steps.length === 0) {
      issues.push({ path: '$.steps', message: 'empty workflow — nothing to execute' });
    }
    const seen = new Set<string>();
    w.steps.forEach((s: any, i: number) => {
      const p = `$.steps[${i}]`;
      if (!s || typeof s !== 'object') {
        issues.push({ path: p, message: 'step must be an object' });
        return;
      }
      if (typeof s.id !== 'string' || !s.id) {
        issues.push({ path: `${p}.id`, message: 'required non-empty string' });
      } else if (seen.has(s.id)) {
        issues.push({ path: `${p}.id`, message: `duplicate step id "${s.id}"` });
      } else {
        seen.add(s.id);
      }
      if (typeof s.tool !== 'string' || !s.tool) {
        issues.push({ path: `${p}.tool`, message: 'required TeleDOM tool name' });
      }
      if (s.args != null && (typeof s.args !== 'object' || Array.isArray(s.args))) {
        issues.push({ path: `${p}.args`, message: 'must be an object' });
      }
      if (s.onError !== undefined && !['abort', 'continue', 'skip'].includes(s.onError)) {
        issues.push({ path: `${p}.onError`, message: 'must be abort | continue | skip' });
      }
      if (s.retry !== undefined && (typeof s.retry !== 'object' || typeof s.retry.count !== 'number' || s.retry.count < 0 || s.retry.count > 10)) {
        issues.push({ path: `${p}.retry.count`, message: 'must be a number in [0,10]' });
      }
      if (s.timeoutMs !== undefined && (typeof s.timeoutMs !== 'number' || s.timeoutMs <= 0)) {
        issues.push({ path: `${p}.timeoutMs`, message: 'must be a positive number' });
      }
    });
  }
  if (w.policy != null) { // null (JSON) and undefined both mean absent
    const pol = w.policy as any;
    for (const k of ['allowedTools', 'deniedTools', 'requireApprovalFor', 'allowedDomains', 'deniedDomains'] as const) {
      if (pol[k] !== undefined && (!Array.isArray(pol[k]) || pol[k].some((x: unknown) => typeof x !== 'string'))) {
        issues.push({ path: `$.policy.${k}`, message: 'must be an array of strings' });
      }
    }
    for (const k of ['maxSteps', 'maxRuntimeMs', 'maxStepMs'] as const) {
      if (pol[k] !== undefined && (typeof pol[k] !== 'number' || pol[k] <= 0)) {
        issues.push({ path: `$.policy.${k}`, message: 'must be a positive number' });
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

export class AgentStore {
  private readonly root: string;

  constructor(baseDir?: string) {
    this.root = baseDir
      ?? process.env.TELEDOM_AGENT_STORE_DIR
      ?? path.join(process.cwd(), '.teledom_agent');
    // v4.1: directories are created lazily on first WRITE — constructing the
    // store (e.g. inside unit tests or read-only deployments) has zero
    // filesystem side effects.
  }

  private ensured = false;
  private ensureDir(): void {
    if (this.ensured) return;
    const artifactKinds: AgentArtifactKind[] = ['custom-tool', 'script', 'policy', 'memory', 'note'];
    for (const sub of ['workflows', 'runs', 'targets', ...artifactKinds.map((k) => path.join('artifacts', k))]) {
      fs.mkdirSync(path.join(this.root, sub), { recursive: true });
    }
    this.ensured = true;
  }

  get storeDir(): string {
    return this.root;
  }

  // ── atomic write helper ────────────────────────────────────────────────
  private writeJson(file: string, data: unknown): void {
    this.ensureDir();
    const tmp = `${file}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
  }

  private readJson<T>(file: string): T | null {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.warn(`[WorkflowStore] Warning: Failed to read or parse ${file}:`, err?.message || err);
      }
      return null;
    }
  }

  private listJsonNames(dir: string): string[] {
    try {
      return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.warn(`[WorkflowStore] Warning: Failed to list directory ${dir}:`, err?.message || err);
      }
      return [];
    }
  }

  // ── Workflows (versioned envelopes) ───────────────────────────────────

  saveWorkflow(wf: AgentWorkflow): WorkflowEnvelope {
    const name = safeName(wf.name);
    if (!name) throw new Error('invalid workflow name');
    const file = path.join(this.root, 'workflows', `${name}.json`);
    const existing = this.readJson<WorkflowEnvelope>(file);
    const now = new Date().toISOString();
    const workflow: AgentWorkflow = { ...wf, name, updatedAt: now, createdAt: existing?.current.createdAt ?? now };
    const envelope: WorkflowEnvelope = existing
      ? {
          current: workflow,
          versions: [
            ...existing.versions.filter((v) => v.version !== workflow.version),
            { version: workflow.version, savedAt: now, workflow },
          ],
        }
      : { current: workflow, versions: [{ version: workflow.version, savedAt: now, workflow }] };
    this.writeJson(file, envelope);
    return envelope;
  }

  getWorkflow(name: string, version?: string): AgentWorkflow | null {
    const safe = safeName(name);
    if (!safe) return null;
    const envelope = this.readJson<WorkflowEnvelope>(path.join(this.root, 'workflows', `${safe}.json`));
    if (!envelope) return null;
    if (!version || version === envelope.current.version) return envelope.current;
    return envelope.versions.find((v) => v.version === version)?.workflow ?? null;
  }

  getWorkflowEnvelope(name: string): WorkflowEnvelope | null {
    const safe = safeName(name);
    if (!safe) return null;
    return this.readJson<WorkflowEnvelope>(path.join(this.root, 'workflows', `${safe}.json`));
  }

  listWorkflows(): { name: string; version: string; description?: string; tags?: string[]; steps: number; versions: number; updatedAt: string }[] {
    return this.listJsonNames(path.join(this.root, 'workflows')).map((f) => {
      const env = this.readJson<WorkflowEnvelope>(path.join(this.root, 'workflows', f));
      return env
        ? {
            name: env.current.name,
            version: env.current.version,
            description: env.current.description,
            tags: env.current.tags,
            steps: env.current.steps?.length ?? 0,
            versions: env.versions.length,
            updatedAt: env.current.updatedAt,
          }
        : { name: f.replace(/\.json$/, ''), version: '?', steps: 0, versions: 0, updatedAt: '?' };
    });
  }

  deleteWorkflow(name: string): boolean {
    const safe = safeName(name);
    if (!safe) return false;
    const file = path.join(this.root, 'workflows', `${safe}.json`);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  }

  // ── Execution records (runs) ──────────────────────────────────────────

  saveRun(run: WorkflowRun): WorkflowRun {
    const file = path.join(this.root, 'runs', `${run.id}.json`);
    this.writeJson(file, run);
    this.pruneRuns();
    return run;
  }

  getRun(runId: string): WorkflowRun | null {
    const safe = safeName(runId);
    if (!safe) return null;
    return this.readJson<WorkflowRun>(path.join(this.root, 'runs', `${safe}.json`));
  }

  listRuns(filter?: { workflowName?: string; limit?: number }): { id: string; workflowName: string; workflowVersion: string; status: string; startedAt: number; durationMs?: number; steps: number; replayOf?: string }[] {
    const all: WorkflowRun[] = [];
    for (const f of this.listJsonNames(path.join(this.root, 'runs'))) {
      const run = this.readJson<WorkflowRun>(path.join(this.root, 'runs', f));
      if (!run) continue;
      if (filter?.workflowName && run.workflowName !== filter.workflowName) continue;
      all.push(run);
    }
    all.sort((a, b) => b.startedAt - a.startedAt);
    const limit = filter?.limit ?? 50;
    return all.slice(0, limit).map((r) => ({
      id: r.id,
      workflowName: r.workflowName,
      workflowVersion: r.workflowVersion,
      status: r.status,
      startedAt: r.startedAt,
      durationMs: r.metrics?.durationMs,
      steps: r.steps?.length ?? 0,
      replayOf: r.replayOf,
    }));
  }

  private pruneRuns(): void {
    const dir = path.join(this.root, 'runs');
    const files = this.listJsonNames(dir).map((f) => ({
      file: path.join(dir, f),
      mtime: fs.statSync(path.join(dir, f)).mtimeMs,
    }));
    if (files.length <= RUN_KEEP_LIMIT) return;
    files.sort((a, b) => a.mtime - b.mtime);
    for (const f of files.slice(0, files.length - RUN_KEEP_LIMIT)) {
      try { fs.unlinkSync(f.file); } catch { /* best effort */ }
    }
    // Per-workflow cap
    const byName = new Map<string, string[]>();
    for (const f of files) {
      const run = this.readJson<WorkflowRun>(f.file);
      if (!run) continue;
      const list = byName.get(run.workflowName) ?? [];
      list.push(f.file);
      byName.set(run.workflowName, list);
    }
    for (const [name, list] of byName) {
      if (name && list.length > MAX_RUNS_PER_WORKFLOW) {
        for (const file of list.slice(0, list.length - MAX_RUNS_PER_WORKFLOW)) {
          try { fs.unlinkSync(file); } catch { /* best effort */ }
        }
      }
    }
  }

  // ── Learned targets (target memory) ───────────────────────────────────

  targetId(site: string, semanticId: string): string {
    const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9*-]+/g, '_');
    return `${norm(site)}__${norm(semanticId)}`;
  }

  saveTarget(t: Omit<LearnedTarget, 'createdAt' | 'updatedAt' | 'id'>): LearnedTarget {
    const id = this.targetId(t.site, t.semanticId);
    const file = path.join(this.root, 'targets', `${id}.json`);
    const existing = this.readJson<LearnedTarget>(file);
    const now = new Date().toISOString();
    const target: LearnedTarget = {
      ...t,
      id,
      history: {
        // history ACCUMULATES across saves (deduped, bounded) — this is the
        // whole point of target memory: successful/failed selectors persist.
        successfulSelectors: Array.from(new Set([
          ...(existing?.history.successfulSelectors ?? []),
          ...(t.history.successfulSelectors ?? []),
        ])).slice(-20),
        failedSelectors: Array.from(new Set([
          ...(existing?.history.failedSelectors ?? []),
          ...(t.history.failedSelectors ?? []),
        ])).slice(-20),
        resolvedCount: Math.max(existing?.history.resolvedCount ?? 0, t.history.resolvedCount ?? 0),
        lastResolvedAt: t.history.lastResolvedAt ?? existing?.history.lastResolvedAt,
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.writeJson(file, target);
    return target;
  }

  getTarget(site: string, semanticId: string): LearnedTarget | null {
    const id = this.targetId(site, semanticId);
    return this.readJson<LearnedTarget>(path.join(this.root, 'targets', `${id}.json`));
  }

  listTargets(filter?: { site?: string; semanticId?: string }): { id: string; site: string; semanticId: string; confidence: number; css?: string; updatedAt: string }[] {
    const out: { id: string; site: string; semanticId: string; confidence: number; css?: string; updatedAt: string }[] = [];
    for (const f of this.listJsonNames(path.join(this.root, 'targets'))) {
      const t = this.readJson<LearnedTarget>(path.join(this.root, 'targets', f));
      if (!t) continue;
      if (filter?.site && t.site !== filter.site && t.site !== '*') continue;
      if (filter?.semanticId && t.semanticId !== filter.semanticId) continue;
      out.push({ id: t.id, site: t.site, semanticId: t.semanticId, confidence: t.confidence?.current ?? 0, css: t.locators?.css, updatedAt: t.updatedAt });
    }
    return out;
  }

  deleteTarget(site: string, semanticId: string): boolean {
    const id = this.targetId(site, semanticId);
    const file = path.join(this.root, 'targets', `${id}.json`);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  }

  // ── Generic agent artifacts ───────────────────────────────────────────

  saveArtifact(kind: AgentArtifactKind, name: string, content: unknown, meta?: { description?: string; tags?: string[] }): AgentArtifact {
    const safe = safeName(name);
    if (!safe) throw new Error('invalid artifact name');
    const file = path.join(this.root, 'artifacts', kind, `${safe}.json`);
    const existing = this.readJson<AgentArtifact>(file);
    const now = new Date().toISOString();
    const artifact: AgentArtifact = {
      id: existing?.id ?? randomUUID(),
      kind,
      name: safe,
      content,
      description: meta?.description,
      tags: meta?.tags,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.writeJson(file, artifact);
    return artifact;
  }

  getArtifact(kind: AgentArtifactKind, name: string): AgentArtifact | null {
    const safe = safeName(name);
    if (!safe) return null;
    return this.readJson<AgentArtifact>(path.join(this.root, 'artifacts', kind, `${safe}.json`));
  }

  listArtifacts(kind?: AgentArtifactKind, tag?: string): { kind: string; name: string; description?: string; tags?: string[]; updatedAt: string }[] {
    const kinds: AgentArtifactKind[] = kind ? [kind] : ['custom-tool', 'script', 'policy', 'memory', 'note'];
    const out: { kind: string; name: string; description?: string; tags?: string[]; updatedAt: string }[] = [];
    for (const k of kinds) {
      for (const f of this.listJsonNames(path.join(this.root, 'artifacts', k))) {
        const a = this.readJson<AgentArtifact>(path.join(this.root, 'artifacts', k, f));
        if (!a) continue;
        if (tag && !(a.tags ?? []).includes(tag)) continue;
        out.push({ kind: k, name: a.name, description: a.description, tags: a.tags, updatedAt: a.updatedAt });
      }
    }
    return out;
  }

  deleteArtifact(kind: AgentArtifactKind, name: string): boolean {
    const safe = safeName(name);
    if (!safe) return false;
    const file = path.join(this.root, 'artifacts', kind, `${safe}.json`);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  }

  // ── Platform memory snapshot (persistence for td_memory) ──────────────

  saveMemorySnapshot(snapshot: unknown): void {
    this.writeJson(path.join(this.root, 'memory.json'), { savedAt: new Date().toISOString(), snapshot });
  }

  loadMemorySnapshot(): unknown | null {
    const data = this.readJson<{ savedAt: string; snapshot: unknown }>(path.join(this.root, 'memory.json'));
    return data?.snapshot ?? null;
  }
}

// ── Workflow diff (structural, for td_workflow_diff) ─────────────────────

export function diffWorkflows(a: AgentWorkflow, b: AgentWorkflow): {
  changed: boolean;
  summary: { addedSteps: string[]; removedSteps: string[]; changedSteps: string[]; policyChanged: boolean; descriptionChanged: boolean };
  patches: { path: string; before: unknown; after: unknown }[];
} {
  const patches: { path: string; before: unknown; after: unknown }[] = [];
  const aSteps = new Map(a.steps.map((s) => [s.id, s]));
  const bSteps = new Map(b.steps.map((s) => [s.id, s]));
  const addedSteps = [...bSteps.keys()].filter((id) => !aSteps.has(id));
  const removedSteps = [...aSteps.keys()].filter((id) => !bSteps.has(id));
  const changedSteps: string[] = [];
  for (const [id, sa] of aSteps) {
    const sb = bSteps.get(id);
    if (!sb) continue;
    if (JSON.stringify(sa) !== JSON.stringify(sb)) {
      changedSteps.push(id);
      if (sa.tool !== sb.tool) patches.push({ path: `steps.${id}.tool`, before: sa.tool, after: sb.tool });
      if (JSON.stringify(sa.args) !== JSON.stringify(sb.args)) patches.push({ path: `steps.${id}.args`, before: sa.args, after: sb.args });
      if (sa.onError !== sb.onError) patches.push({ path: `steps.${id}.onError`, before: sa.onError, after: sb.onError });
    }
  }
  for (const id of addedSteps) patches.push({ path: `steps.${id}`, before: null, after: bSteps.get(id) });
  for (const id of removedSteps) patches.push({ path: `steps.${id}`, before: aSteps.get(id), after: null });
  const policyChanged = JSON.stringify(a.policy) !== JSON.stringify(b.policy);
  if (policyChanged) patches.push({ path: 'policy', before: a.policy, after: b.policy });
  const descriptionChanged = a.description !== b.description;
  return {
    changed: patches.length > 0,
    summary: { addedSteps, removedSteps, changedSteps, policyChanged, descriptionChanged },
    patches,
  };
}
