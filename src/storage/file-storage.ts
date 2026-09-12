import * as fs from 'fs';
import * as path from 'path';
import { Annotation, SessionMetadata } from '../types/session';
import { BaseEvent } from '../types/events';
import { SnapshotCheckpoint } from '../types/checkpoint';
import { DOMSnapshot } from '../types/dom-node';
import { EventFilter, ForensicStorageProvider } from './storage-interface';

export class FileStorageProvider implements ForensicStorageProvider {
  private baseDir: string;

  constructor(baseDir: string = './.forensic_sessions') {
    this.baseDir = path.resolve(baseDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getSessionDir(sessionId: string): string {
    const dir = path.join(this.baseDir, sessionId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  public async saveSession(metadata: SessionMetadata): Promise<void> {
    const dir = this.getSessionDir(metadata.id);
    const metaPath = path.join(dir, 'metadata.json');
    await fs.promises.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  public async getSession(sessionId: string): Promise<SessionMetadata | null> {
    const dir = path.join(this.baseDir, sessionId);
    const metaPath = path.join(dir, 'metadata.json');
    try {
      const data = await fs.promises.readFile(metaPath, 'utf-8');
      return JSON.parse(data) as SessionMetadata;
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.warn(`[FileStorage] Warning: Failed to read session ${sessionId}: ${err?.message}`);
      }
      return null;
    }
  }

  public async listSessions(): Promise<SessionMetadata[]> {
    if (!fs.existsSync(this.baseDir)) return [];
    try {
      const entries = await fs.promises.readdir(this.baseDir, { withFileTypes: true });
      const sessions: SessionMetadata[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const metaPath = path.join(this.baseDir, entry.name, 'metadata.json');
          try {
            const data = await fs.promises.readFile(metaPath, 'utf-8');
            sessions.push(JSON.parse(data) as SessionMetadata);
          } catch (err: any) {
            if (err?.code !== 'ENOENT') {
              console.warn(`[FileStorage] Warning: Corrupt or unreadable session metadata at ${metaPath}: ${err?.message}`);
            }
          }
        }
      }

      return sessions.sort((a, b) => b.startTime - a.startTime);
    } catch (err: any) {
      console.error(`[FileStorage] Failed to list sessions from ${this.baseDir}:`, err?.message);
      return [];
    }
  }

  public async deleteSession(sessionId: string): Promise<boolean> {
    const dir = path.join(this.baseDir, sessionId);
    if (fs.existsSync(dir)) {
      await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      return true;
    }
    return false;
  }

  public async appendEvents(sessionId: string, events: BaseEvent[]): Promise<void> {
    if (events.length === 0) return;
    const dir = this.getSessionDir(sessionId);
    const eventsPath = path.join(dir, 'events.jsonl');
    const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await fs.promises.appendFile(eventsPath, lines, 'utf-8');
  }

  public async getEvents(sessionId: string, filter?: EventFilter): Promise<BaseEvent[]> {
    const dir = path.join(this.baseDir, sessionId);
    const eventsPath = path.join(dir, 'events.jsonl');
    if (!fs.existsSync(eventsPath)) return [];

    const content = await fs.promises.readFile(eventsPath, 'utf-8');
    const lines = content.split(/\r?\n/);

    const results: BaseEvent[] = [];
    let matchedCount = 0;
    const offset = typeof filter?.offset === 'number' ? filter.offset : 0;
    const limit = typeof filter?.limit === 'number' ? filter.limit : Infinity;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let e: BaseEvent;
      try {
        e = JSON.parse(trimmed);
      } catch (parseErr) {
        console.warn(`[FileStorage] Skipping malformed event line in session ${sessionId}:`, parseErr);
        continue;
      }

      if (filter) {
        if (filter.category && e.category !== filter.category) continue;
        if (filter.type && e.type !== filter.type) continue;
        if (typeof filter.fromTimestamp === 'number' && e.timestamp < filter.fromTimestamp) continue;
        if (typeof filter.toTimestamp === 'number' && e.timestamp > filter.toTimestamp) continue;
        if (typeof filter.fromSequence === 'number' && e.sequence < filter.fromSequence) continue;
        if (typeof filter.toSequence === 'number' && e.sequence > filter.toSequence) continue;
        if (typeof filter.targetNodeId === 'number' && e.targetNodeId !== filter.targetNodeId) continue;
        if (filter.targetSelector && e.targetSelector && !e.targetSelector.includes(filter.targetSelector)) continue;

        if (filter.searchQuery) {
          const query = filter.searchQuery.toLowerCase();
          const strPayload = JSON.stringify(e.payload || {}).toLowerCase();
          if (!strPayload.includes(query) && !e.type.toLowerCase().includes(query)) {
            continue;
          }
        }
      }

      matchedCount++;
      if (matchedCount <= offset) {
        continue;
      }

      results.push(e);
      if (results.length >= limit) {
        break;
      }
    }

    return results;
  }

  public async getEventCount(sessionId: string): Promise<number> {
    const dir = path.join(this.baseDir, sessionId);
    const eventsPath = path.join(dir, 'events.jsonl');
    if (!fs.existsSync(eventsPath)) return 0;

    const content = await fs.promises.readFile(eventsPath, 'utf-8');
    let count = 0;
    for (const line of content.split(/\r?\n/)) {
      if (line.trim()) count++;
    }
    return count;
  }

  public async saveCheckpoint(checkpoint: SnapshotCheckpoint): Promise<void> {
    const dir = this.getSessionDir(checkpoint.sessionId);
    const chkDir = path.join(dir, 'checkpoints');
    await fs.promises.mkdir(chkDir, { recursive: true });

    const file = path.join(chkDir, `${checkpoint.checkpointId}.json`);
    await fs.promises.writeFile(file, JSON.stringify(checkpoint, null, 2), 'utf-8');
  }

  public async getCheckpoints(sessionId: string): Promise<SnapshotCheckpoint[]> {
    const dir = path.join(this.baseDir, sessionId, 'checkpoints');
    try {
      const files = (await fs.promises.readdir(dir)).filter((f) => f.endsWith('.json'));
      const checkpoints: SnapshotCheckpoint[] = [];

      for (const f of files) {
        try {
          const data = await fs.promises.readFile(path.join(dir, f), 'utf-8');
          checkpoints.push(JSON.parse(data));
        } catch (err) {
          console.warn(`[FileStorage] Failed to read/parse checkpoint file ${f} in session ${sessionId}:`, err);
        }
      }

      return checkpoints.sort((a, b) => a.sequence - b.sequence);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.warn(`[FileStorage] Error accessing checkpoints directory for session ${sessionId}:`, err);
      }
      return [];
    }
  }

  public async saveInitialSnapshot(sessionId: string, snapshot: DOMSnapshot): Promise<void> {
    const dir = this.getSessionDir(sessionId);
    const file = path.join(dir, 'initial_snapshot.json');
    await fs.promises.writeFile(file, JSON.stringify(snapshot, null, 2), 'utf-8');
  }

  public async getInitialSnapshot(sessionId: string): Promise<DOMSnapshot | null> {
    const dir = path.join(this.baseDir, sessionId);
    const file = path.join(dir, 'initial_snapshot.json');
    try {
      const content = await fs.promises.readFile(file, 'utf-8');
      return JSON.parse(content) as DOMSnapshot;
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.warn(`[FileStorage] Error reading initial snapshot for session ${sessionId}:`, err);
      }
      return null;
    }
  }

  public async addAnnotation(annotation: Annotation): Promise<void> {
    const dir = this.getSessionDir(annotation.sessionId);
    const annPath = path.join(dir, 'annotations.json');
    let list: Annotation[] = [];
    try {
      const content = await fs.promises.readFile(annPath, 'utf-8');
      list = JSON.parse(content);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.warn(`[FileStorage] Corrupted annotations file for session ${annotation.sessionId}, starting fresh:`, err);
      }
      list = [];
    }
    list.push(annotation);
    await fs.promises.writeFile(annPath, JSON.stringify(list, null, 2), 'utf-8');
  }

  public async getAnnotations(sessionId: string): Promise<Annotation[]> {
    const dir = path.join(this.baseDir, sessionId);
    const annPath = path.join(dir, 'annotations.json');
    try {
      const content = await fs.promises.readFile(annPath, 'utf-8');
      return JSON.parse(content) as Annotation[];
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.warn(`[FileStorage] Failed to read annotations for session ${sessionId}:`, err);
      }
      return [];
    }
  }
}
