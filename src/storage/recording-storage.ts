import fs from 'fs';
import path from 'path';
import { CommandRecording } from '../types/browser-control';

/**
 * §23 / §57 — Durable storage for command recordings.
 * Portable JSON files under .mcpdom_recordings/<recordingId>.json.
 * Not coupled to a browser session; another Agent can load and replay.
 */

const RECORDING_SCHEMA_VERSION = '1.0.0';

export class CommandRecordingStorage {
  private baseDir: string;

  constructor(baseDir: string = '.mcpdom_recordings') {
    this.baseDir = baseDir;
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  public save(recording: CommandRecording): string {
    const file = path.join(this.baseDir, `${recording.recordingId}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify({ schemaVersion: RECORDING_SCHEMA_VERSION, savedAt: Date.now(), recording }, null, 2)
    );
    return file;
  }

  public load(recordingId: string): CommandRecording | null {
    const file = path.join(this.baseDir, `${recordingId}.json`);
    if (fs.existsSync(file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return raw.recording || raw;
      } catch (err) {
        console.warn(`[RecordingStorage] Warning: Failed to parse recording file ${file}:`, err);
        return null;
      }
    }
    // Fallback: lookup by NAME (agents and test flows know the human name).
    for (const rec of this.list()) {
      if (rec.name === recordingId) {
        return this.load(rec.recordingId);
      }
    }
    return null;
  }

  public list(): Array<{ recordingId: string; name: string; commandCount: number; createdAt: number; updatedAt: number; tags: string[]; file: string }> {
    const out: any[] = [];
    if (!fs.existsSync(this.baseDir)) return out;
    for (const entry of fs.readdirSync(this.baseDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(this.baseDir, entry.name), 'utf-8'));
        const rec = raw.recording || raw;
        out.push({
          recordingId: rec.recordingId,
          name: rec.name,
          commandCount: rec.commandCount ?? rec.commands?.length ?? 0,
          createdAt: rec.createdAt,
          updatedAt: rec.updatedAt,
          tags: rec.tags || [],
          file: path.join(this.baseDir, entry.name),
        });
      } catch (err) {
        console.warn(`[RecordingStorage] Warning: Skipped corrupt recording file ${entry.name}:`, err);
      }
    }
    return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  public delete(recordingId: string): boolean {
    const file = path.join(this.baseDir, `${recordingId}.json`);
    if (fs.existsSync(file)) {
      fs.rmSync(file);
      return true;
    }
    // Fallback: delete by NAME (find the id first).
    for (const rec of this.list()) {
      if (rec.name === recordingId) {
        return this.delete(rec.recordingId);
      }
    }
    return false;
  }

  public importFromJson(json: string): CommandRecording {
    const parsed = JSON.parse(json);
    const rec = parsed.recording || parsed;
    if (!rec.recordingId || !Array.isArray(rec.commands)) {
      throw new Error('INVALID_RECORDING: JSON does not look like a CommandRecording export.');
    }
    const imported: CommandRecording = {
      ...rec,
      recordingId: `${rec.recordingId}_imported_${Date.now().toString(36)}`,
      name: `${rec.name || 'recording'} (imported)`,
      updatedAt: Date.now(),
    };
    this.save(imported);
    return imported;
  }
}
