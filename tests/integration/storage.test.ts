import { describe, it, expect } from 'vitest';
import { MemoryStorageProvider } from '../../src/storage/memory-storage';
import { FileStorageProvider } from '../../src/storage/file-storage';
import * as fs from 'fs';
import * as path from 'path';

describe('Storage Providers (Memory & File)', () => {
  it('should save, list, retrieve, filter events, and delete sessions in MemoryStorage', async () => {
    const storage = new MemoryStorageProvider();
    const sessionId = 'mem_sess_1';

    await storage.saveSession({
      id: sessionId,
      name: 'Mem Session',
      url: 'https://app.com',
      origin: 'https://app.com',
      title: 'App',
      userAgent: 'Agent',
      schemaVersion: '2.0.0',
      recorderVersion: '2.0.0',
      extensionVersion: '2.0.0',
      startTime: 1000,
      status: 'recording',
      health: {
        domRecording: 'HEALTHY',
        userEvents: 'HEALTHY',
        console: 'HEALTHY',
        network: 'HEALTHY',
        screenshots: 'HEALTHY',
        shadowDom: 'HEALTHY',
        iframes: 'HEALTHY',
      },
      stats: {
        eventCount: 0,
        mutationCount: 0,
        errorCount: 0,
        consoleCount: 0,
        networkCount: 0,
        checkpointCount: 0,
        screenshotCount: 0,
        nodeCount: 0,
      },
    });

    await storage.appendEvents(sessionId, [
      {
        id: 'e1',
        sessionId,
        timestamp: 10,
        sequence: 1,
        wallClockTime: 1010,
        type: 'USER_CLICK',
        category: 'USER',
        source: 'USER_INTERACTION',
        payload: { targetSelector: '#btn' },
      },
      {
        id: 'e2',
        sessionId,
        timestamp: 50,
        sequence: 2,
        wallClockTime: 1050,
        type: 'RUNTIME_ERROR',
        category: 'ERROR',
        source: 'PAGE',
        payload: { message: 'Uncaught Error' },
      },
    ]);

    const sessions = await storage.listSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe(sessionId);

    const userEvents = await storage.getEvents(sessionId, { category: 'USER' });
    expect(userEvents.length).toBe(1);
    expect(userEvents[0].type).toBe('USER_CLICK');

    const errEvents = await storage.getEvents(sessionId, { category: 'ERROR' });
    expect(errEvents.length).toBe(1);
    expect(errEvents[0].type).toBe('RUNTIME_ERROR');

    const deleted = await storage.deleteSession(sessionId);
    expect(deleted).toBe(true);
    expect(await storage.getSession(sessionId)).toBeNull();
  });

  it('should persist and retrieve sessions to filesystem with FileStorageProvider', async () => {
    const testDir = path.resolve('./.test_forensic_storage');
    const storage = new FileStorageProvider(testDir);
    const sessionId = 'file_sess_1';

    try {
      await storage.saveSession({
        id: sessionId,
        name: 'File Session',
        url: 'https://test.io',
        origin: 'https://test.io',
        title: 'File Test',
        userAgent: 'Agent',
        schemaVersion: '2.0.0',
        recorderVersion: '2.0.0',
        extensionVersion: '2.0.0',
        startTime: 2000,
        status: 'stopped',
        health: {
          domRecording: 'HEALTHY',
          userEvents: 'HEALTHY',
          console: 'HEALTHY',
          network: 'HEALTHY',
          screenshots: 'HEALTHY',
          shadowDom: 'HEALTHY',
          iframes: 'HEALTHY',
        },
        stats: {
          eventCount: 1,
          mutationCount: 0,
          errorCount: 0,
          consoleCount: 0,
          networkCount: 0,
          checkpointCount: 0,
          screenshotCount: 0,
          nodeCount: 1,
        },
      });

      await storage.appendEvents(sessionId, [
        {
          id: 'f1',
          sessionId,
          timestamp: 20,
          sequence: 1,
          wallClockTime: 2020,
          type: 'USER_CLICK',
          category: 'USER',
          source: 'USER_INTERACTION',
          payload: { targetSelector: '.action-btn' },
        },
      ]);

      const session = await storage.getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session?.name).toBe('File Session');

      const events = await storage.getEvents(sessionId);
      expect(events.length).toBe(1);
      expect(events[0].id).toBe('f1');

      // Test streaming pagination with multiple events
      const moreEvents = Array.from({ length: 50 }, (_, i) => ({
        id: `f_stream_${i}`,
        sessionId,
        timestamp: 100 + i * 10,
        sequence: i + 2,
        wallClockTime: 2100 + i * 10,
        type: (i % 2 === 0 ? 'DOM_MUTATION_ATTR' : 'USER_INPUT') as any,
        category: (i % 2 === 0 ? 'DOM' : 'USER') as any,
        source: 'PAGE' as const,
        payload: { index: i },
      }));

      await storage.appendEvents(sessionId, moreEvents);

      const totalCount = await storage.getEventCount(sessionId);
      expect(totalCount).toBe(51);

      // Paginate: limit 5, offset 10
      const paged = await storage.getEvents(sessionId, { limit: 5, offset: 10 });
      expect(paged.length).toBe(5);
      expect((paged[0].payload as any).index).toBe(9);

      // Category filter + limit
      const userPaged = await storage.getEvents(sessionId, { category: 'USER', limit: 3 });
      expect(userPaged.length).toBe(3);
      expect(userPaged.every((e) => e.category === 'USER')).toBe(true);
    } finally {
      if (fs.existsSync(testDir)) {
        try {
          fs.rmSync(testDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        } catch {
          // Allow transient lock in Windows test runners to drain
        }
      }
    }
  }, 30_000);
});
