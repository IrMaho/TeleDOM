import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { ForensicStorageProvider } from '../storage/storage-interface';
import { SessionSerializer } from '../storage/session-serializer';
import { FileStorageProvider } from '../storage/file-storage';
import { MCPToolsHandler } from './tools-handler';
import { BrowserBridgeClient } from './live-tools-handler';
import { BrowserCommandType } from '../types/browser-control';
import { TELEDOM_VERSION } from '../intelligence/version';

export interface ConnectedClientInfo {
  id: string;
  clientType: 'CONTENT_SCRIPT' | 'SERVICE_WORKER' | 'UNKNOWN';
  url?: string;
  title?: string;
  connectedAt: number;
}

export class MCPBridgeServer implements BrowserBridgeClient {
  private port: number;
  private storage: ForensicStorageProvider;
  private toolsHandler: MCPToolsHandler;
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private activeSockets: Set<WebSocket> = new Set();
  private socketMetadata: Map<WebSocket, ConnectedClientInfo> = new Map();
  /** §55 liveness: last heartbeat (or any message) per socket. */
  private clientHealth: Map<WebSocket, number> = new Map();
  /** §53 fix: monotonically increasing client id counter — never reused. */
  private clientIdCounter = 0;
  /** §55 liveness sweeper interval handle. */
  private healthSweepInterval: NodeJS.Timeout | null = null;
  private pendingCommands = new Map<
    string,
    { resolve: (val: any) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(port: number = 3847, storage?: ForensicStorageProvider) {
    this.port = port;
    this.storage = storage || new FileStorageProvider('./.forensic_sessions');
    this.toolsHandler = new MCPToolsHandler(this.storage);
    this.toolsHandler.getLiveToolsHandler().setBridgeClient(this);
    this.toolsHandler.getExtendedToolsHandler().setBridgeClient(this);
  }

  public getToolsHandler(): MCPToolsHandler {
    return this.toolsHandler;
  }

  /**
   * BrowserBridgeClient implementation: Send live command to connected Chrome extension
   */
  public async sendCommand(command: BrowserCommandType, payload?: any): Promise<any> {
    if (this.activeSockets.size === 0) {
      throw new Error('No active browser extension connected to MCP bridge');
    }

    // Fallback instant resolution for LIST_TABS only if NO service worker is connected
    const hasServiceWorker = Array.from(this.socketMetadata.values()).some(m => m.clientType === 'SERVICE_WORKER');
    if (command === 'LIST_TABS' && !hasServiceWorker) {
      const tabsList = Array.from(this.socketMetadata.entries())
        .filter(([sock, meta]) => meta.clientType === 'CONTENT_SCRIPT' && sock.readyState === WebSocket.OPEN)
        .map(([sock, meta], idx) => ({
          id: idx + 1,
          socketId: meta.id,
          title: meta.title || 'Untitled Tab',
          url: meta.url || '',
          active: true,
          status: 'complete',
          clientType: meta.clientType,
        }));

      if (tabsList.length > 0) {
        return {
          totalTabs: tabsList.length,
          tabs: tabsList,
        };
      }
    }

    const commandId = `bridge_cmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCommands.delete(commandId);
        reject(new Error(`Browser command '${command}' timed out after 8000ms`));
      }, 8000);

      this.pendingCommands.set(commandId, { resolve, reject, timer });

      const msg = JSON.stringify({
        type: 'BROWSER_COMMAND_REQUEST',
        id: commandId,
        command,
        payload,
        timestamp: Date.now(),
      });

      let targets: WebSocket[] = [];
      // Always prefer SERVICE_WORKER because it has authoritative access to chrome.tabs, chrome.management, captureVisibleTab, and tab messaging
      for (const [sock, meta] of this.socketMetadata.entries()) {
        if (meta.clientType === 'SERVICE_WORKER' && sock.readyState === WebSocket.OPEN) {
          targets.push(sock);
        }
      }

      // If no service worker connected, fallback to a single primary CONTENT_SCRIPT socket (never broadcast commands to all tabs)
      if (targets.length === 0) {
        for (const [sock, meta] of this.socketMetadata.entries()) {
          if (meta.clientType === 'CONTENT_SCRIPT' && sock.readyState === WebSocket.OPEN) {
            targets = [sock];
            break;
          }
        }
      }

      if (targets.length === 0 && this.activeSockets.size > 0) {
        const first = Array.from(this.activeSockets).find((s) => s.readyState === WebSocket.OPEN);
        if (first) targets = [first];
      }

      let sentCount = 0;
      for (const ws of targets) {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(msg);
            sentCount++;
          } catch (err: any) {
            // v4.1 fix (E-20): was a silent catch — a dead socket would drop
            // commands invisibly. Report and continue with other targets.
            console.error(`[MCP Bridge] send failed to a target socket: ${err?.message ?? err}`);
          }
        }
      }
      console.error(`[MCP Bridge] Dispatched command '${command}' (ID: ${commandId}) to ${sentCount} target socket(s)`);

      if (sentCount === 0) {
        clearTimeout(timer);
        this.pendingCommands.delete(commandId);
        reject(new Error('No open WebSocket connections available to dispatch command'));
      }
    });
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const isTrustedOrigin = (origin?: string): boolean => {
        if (!origin) return true; // Direct non-browser callers (Node, curl, stdio MCP)
        if (origin.startsWith('chrome-extension://')) return true;
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
        return false;
      };

      this.httpServer = http.createServer(async (req, res) => {
        const origin = req.headers.origin;
        if (origin) {
          if (isTrustedOrigin(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Vary', 'Origin');
          } else if (req.method === 'OPTIONS') {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'CORS Forbidden: Untrusted cross-origin request rejected' }));
            return;
          }
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-teledom-token');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = req.url || '';

        // Security check for mutating and sensitive endpoints
        const isAuthValid = (): boolean => {
          if (!isTrustedOrigin(origin)) return false;
          const expectedToken = process.env.TELEDOM_BRIDGE_TOKEN;
          if (!expectedToken) return true;
          const authHeader = req.headers.authorization;
          const tokenHeader = req.headers['x-teledom-token'];
          let queryToken: string | null = null;
          try {
            const parsed = new URL(url, 'http://127.0.0.1');
            queryToken = parsed.searchParams.get('token');
          } catch { /* ignored */ }
          if (authHeader && authHeader.startsWith('Bearer ')) {
            return authHeader.slice(7).trim() === expectedToken;
          }
          if (tokenHeader && tokenHeader === expectedToken) return true;
          if (queryToken && queryToken === expectedToken) return true;
          return false;
        };

        // 1. Health check (v4.1 fix E-17: version derived from the
        // authoritative registry — was stale '3.0.0')
        if (url.startsWith('/health') && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'ok',
              server: 'teledom-bridge',
              version: TELEDOM_VERSION.version,
              connectedBrowsers: this.activeSockets.size,
            })
          );
          return;
        }

        // Enforce authorization for sensitive endpoints
        if (['/api/mcp/tool', '/api/tabs/close', '/api/sessions/upload'].some(p => url.startsWith(p))) {
          if (!isAuthValid()) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden: Invalid or missing authorization credentials' }));
            return;
          }
        }

        const MAX_PAYLOAD_BYTES = 50 * 1024 * 1024; // 50MB limit

        // 2. Upload Session Bundle
        if (url === '/api/sessions/upload' && req.method === 'POST') {
          let body = '';
          let isTooLarge = false;

          req.on('data', (chunk) => {
            if (isTooLarge) return;
            body += chunk;
            if (body.length > MAX_PAYLOAD_BYTES) {
              isTooLarge = true;
              res.writeHead(413, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Payload too large (exceeds 50MB)' }));
              req.destroy();
            }
          });

          req.on('end', async () => {
            if (isTooLarge) return;
            try {
              const bundle = SessionSerializer.importFromJson(body);
              await this.storage.saveSession(bundle.metadata);
              await this.storage.saveInitialSnapshot(bundle.metadata.id, bundle.initialSnapshot);
              await this.storage.appendEvents(bundle.metadata.id, bundle.events);
              for (const chk of bundle.checkpoints) {
                await this.storage.saveCheckpoint(chk);
              }
              for (const ann of bundle.annotations) {
                await this.storage.addAnnotation(ann);
              }

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, sessionId: bundle.metadata.id }));
            } catch (err: any) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }

        // 3. List Connected Clients
        if (url === '/api/clients' && req.method === 'GET') {
          const clients = Array.from(this.socketMetadata.values());
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ total: clients.length, clients }));
          return;
        }

        // 4. Quick Close Tab Endpoint
        if (url === '/api/tabs/close' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => { body += chunk; });
          req.on('end', async () => {
            try {
              const payload = body ? JSON.parse(body) : {};
              const result = await this.sendCommand('CLOSE_TAB', payload);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, result }));
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
          return;
        }

        // 5. MCP Tool Call via HTTP POST
        if (url === '/api/mcp/tool' && req.method === 'POST') {
          let body = '';
          let isTooLarge = false;

          req.on('data', (chunk) => {
            if (isTooLarge) return;
            body += chunk;
            if (body.length > MAX_PAYLOAD_BYTES) {
              isTooLarge = true;
              res.writeHead(413, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Payload too large (exceeds 50MB)' }));
              req.destroy();
            }
          });

          req.on('end', async () => {
            if (isTooLarge) return;
            try {
              const { name, arguments: args } = JSON.parse(body);
              const result = await this.toolsHandler.handleToolCall(name, args || {});
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ isError: true, error: err.message }));
            }
          });
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
      });

      this.httpServer.on('error', (err) => {
        reject(err);
      });

      this.httpServer.listen(this.port, () => {
        this.wss = new WebSocketServer({ server: this.httpServer! });
        this.wss.on('error', () => {});

        // §55 Bridge Resilience: liveness sweeper — probe clients every 30s
        // and prune sockets silent for >75s (extension heartbeats every 15s;
        // three missed beats = dead). Prevents stale-socket state corruption.
        this.healthSweepInterval = setInterval(() => {
          const now = Date.now();
          for (const [ws, lastSeen] of this.clientHealth.entries()) {
            if (now - lastSeen > 75000) {
              console.error(`[MCP Bridge] Liveness sweep: pruning silent client (last seen ${Math.round((now - lastSeen) / 1000)}s ago).`);
              try { ws.terminate(); } catch { /* already dead — nothing to terminate */ }
              this.activeSockets.delete(ws);
              this.socketMetadata.delete(ws);
              this.clientHealth.delete(ws);
            } else {
              try { ws.ping(); } catch { /* dead socket will be swept on the next beat */ }
            }
          }
        }, 30000);
        (this.healthSweepInterval as any)?.unref?.();

        this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
          const origin = req?.headers?.origin;
          if (origin && !isTrustedOrigin(origin)) {
            console.error(`[MCP Bridge] WebSocket connection rejected from untrusted origin: ${origin}`);
            ws.close(4403, 'Forbidden origin');
            return;
          }
          this.activeSockets.add(ws);
          console.error(`[MCP Bridge] Client connected. Total active clients: ${this.activeSockets.size}`);

          ws.on('close', () => {
            this.activeSockets.delete(ws);
            this.socketMetadata.delete(ws);
            this.clientHealth.delete(ws);
            console.error(`[MCP Bridge] Client disconnected. Total active clients: ${this.activeSockets.size}`);
          });

          ws.on('error', (err) => {
            this.activeSockets.delete(ws);
            this.socketMetadata.delete(ws);
            this.clientHealth.delete(ws);
            console.error(`[MCP Bridge] Client error: ${err.message}. Total active clients: ${this.activeSockets.size}`);
          });

          ws.on('message', async (data: string) => {
            try {
              const message = JSON.parse(data.toString());
              console.error(`[MCP Bridge] Inbound: ${JSON.stringify(message)}`);

              // Handle Heartbeat
              if (message.type === 'HEARTBEAT' || message.type === 'PING') {
                // §55 liveness tracking: a client that heartbeats is alive.
                if (this.clientHealth.has(ws)) {
                  this.clientHealth.set(ws, Date.now());
                }
                try {
                  ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
                } catch { /* client vanished between message and reply */ }
                return;
              }

              // Handle Register Client
              if (message.type === 'REGISTER_CLIENT') {
                const clientInfo: ConnectedClientInfo = {
                  // §53 fix: unique monotonically-increasing socket ids —
                  // `size + 1` collided after disconnects.
                  id: `tab_${++this.clientIdCounter}`,
                  clientType: message.clientType || 'CONTENT_SCRIPT',
                  url: message.url || '',
                  title: message.title || '',
                  connectedAt: Date.now(),
                };
                this.socketMetadata.set(ws, clientInfo);
                this.clientHealth.set(ws, Date.now());
                console.error(`[MCP Bridge] Registered client [${clientInfo.id}]: ${clientInfo.title} (${clientInfo.url})`);
                return;
              }

              // Handle Response to Pending Browser Command
              if (message.type === 'BROWSER_COMMAND_RESPONSE' && message.id) {
                const pending = this.pendingCommands.get(message.id);
                if (pending) {
                  if (!message.success && (message.error?.code === 'UNKNOWN_COMMAND' || message.error?.message?.includes('Unsupported command')) && this.activeSockets.size > 1) {
                    return;
                  }
                  clearTimeout(pending.timer);
                  this.pendingCommands.delete(message.id);
                  if (message.success) {
                    pending.resolve(message.data);
                  } else {
                    pending.reject(new Error(message.error?.message || 'Browser command failed'));
                  }
                }
                return;
              }

              // Handle CDP domain events routed from the extension's
              // chrome.debugger gateway (§9 unified runtime).
              if (message.type === 'CDP_EVENT' && message.sessionId) {
                try {
                  const { cdpGateway } = await import('../devtools/runtime/cdp-gateway');
                  cdpGateway.dispatchRemoteEvent(String(message.sessionId), message.method, message.params);
                } catch { /* gateway unavailable */ }
                return;
              }

              // Handle Asynchronous Element Selected Notification
              if (message.type === 'ELEMENT_SELECTED' && message.elementInfo) {
                this.toolsHandler
                  .getLiveToolsHandler()
                  .getLocalController()
                  .getPicker()
                  .setSelectedElement(message.elementInfo);
                return;
              }

              // Handle Historical Streaming Messages
              if (message.type === 'SESSION_START' || message.type === 'FORENSIC_SESSION_START') {
                await this.storage.saveSession(message.metadata);
                if (message.initialSnapshot) {
                  await this.storage.saveInitialSnapshot(message.metadata.id, message.initialSnapshot);
                }
              } else if (message.type === 'EVENTS_CHUNK' || message.type === 'FORENSIC_EVENTS_CHUNK') {
                await this.storage.appendEvents(message.sessionId, message.events);
              } else if (message.type === 'CHECKPOINT' || message.type === 'FORENSIC_CHECKPOINT') {
                await this.storage.saveCheckpoint(message.checkpoint);
              } else if (message.type === 'SESSION_STOP' || message.type === 'FORENSIC_SESSION_STOP') {
                const session = await this.storage.getSession(message.sessionId);
                if (session) {
                  session.status = 'stopped';
                  session.endTime = Date.now();
                  if (message.durationMs) session.durationMs = message.durationMs;
                  await this.storage.saveSession(session);
                }
              }
            } catch (err) {
              console.error('[MCPBridge] WebSocket message processing error:', err);
            }
          });
        });

        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.healthSweepInterval) {
        clearInterval(this.healthSweepInterval);
        this.healthSweepInterval = null;
      }
      for (const [_, pending] of this.pendingCommands) {
        clearTimeout(pending.timer);
        pending.reject(new Error('MCP Bridge stopped'));
      }
      this.pendingCommands.clear();
      this.activeSockets.clear();
      this.clientHealth.clear();

      if (this.wss) {
        this.wss.close();
      }
      if (this.httpServer) {
        this.httpServer.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
