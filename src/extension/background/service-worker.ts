import { IndexedDBStorageProvider } from '../../storage/indexeddb-storage';
import { BaseEvent } from '../../types/events';

const storage = new IndexedDBStorageProvider('ForensicExtensionDB');
let wsBridge: WebSocket | null = null;
let reconnectTimer: any = null;

// Tab-specific active recording state
interface ActiveRecording {
  sessionId: string;
  sessionName: string;
  startTime: number;
  initialUrl: string;
  isRecording: boolean;
}

const activeTabRecordings = new Map<number, ActiveRecording>();

// CDP gateway session → tab binding (§9). Attach records the tab so
// CDP_COMMAND/DETACH route to the right chrome.debugger target.
const cdpTargetsBySession = new Map<string, number>();

/** Resolve the currently active tab id (null when unavailable). */
async function getActiveTabId(): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError || !tabs || tabs.length === 0) return resolve(null);
        resolve(tabs[0].id ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

// Route CDP domain events (HeapProfiler.addHeapSnapshotChunk, Tracing data
// events…) to the bridge so the Node-side gateway can feed its listeners.
try {
  (chrome as any).debugger?.onEvent?.addListener((source: any, method: string, params: any) => {
    try {
      for (const [sessionId, tabId] of cdpTargetsBySession.entries()) {
        if (source?.tabId === tabId || source?.targetId === `tab_${tabId}`) {
          wsBridge?.send(JSON.stringify({
            type: 'CDP_EVENT',
            sessionId,
            method,
            params,
            timestamp: Date.now(),
          }));
          return;
        }
      }
    } catch { /* event routing is best-effort */ }
  });
} catch { /* chrome.debugger unavailable */ }

async function executeBackgroundCommand(command: string, payload: any): Promise<any> {
  if (command === 'LIST_TABS') {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({}, (tabs) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        const tabsList = (tabs || []).map((t) => ({
          id: t.id,
          index: t.index,
          windowId: t.windowId,
          title: t.title || 'Untitled',
          url: t.url || '',
          active: !!t.active,
          status: t.status,
          pinned: !!t.pinned,
          favIconUrl: t.favIconUrl,
          audited: t.id ? activeTabRecordings.has(t.id) : false,
          incognito: !!t.incognito,
          width: t.width,
          height: t.height,
        }));
        resolve({ totalTabs: tabsList.length, tabs: tabsList });
      });
    });
  }

  if (command === 'FOCUS_TAB') {
    const targetTabId = Number(payload?.tabId);
    if (!targetTabId) throw new Error('tabId is required for focus_tab');
    return new Promise((resolve, reject) => {
      chrome.tabs.update(targetTabId, { active: true }, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          return reject(new Error(chrome.runtime.lastError?.message || `Tab ${targetTabId} not found`));
        }
        if (tab.windowId) {
          chrome.windows.update(tab.windowId, { focused: true }, () => {
            resolve({ focused: true, tab: { id: tab.id, windowId: tab.windowId, title: tab.title, url: tab.url, active: tab.active } });
          });
        } else {
          resolve({ focused: true, tab: { id: tab.id, title: tab.title, url: tab.url, active: tab.active } });
        }
      });
    });
  }

  if (command === 'RELOAD_TAB') {
    const bypassCache = !!payload?.bypassCache;
    const explicitTabId = payload?.tabId ? Number(payload.tabId) : undefined;
    return new Promise((resolve, reject) => {
      const executeReload = (targetId: number) => {
        chrome.tabs.reload(targetId, { bypassCache }, () => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          chrome.tabs.get(targetId, (tab) => {
            resolve({ reloaded: true, tabId: targetId, bypassCache, url: tab?.url, title: tab?.title });
          });
        });
      };
      if (explicitTabId) {
        chrome.tabs.get(explicitTabId, (tab) => {
          if (chrome.runtime.lastError || !tab) {
            chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
              const activeTab = tabs && tabs[0] ? tabs[0] : null;
              if (activeTab?.id) executeReload(activeTab.id);
              else reject(new Error('No active tab found to reload'));
            });
          } else {
            executeReload(explicitTabId);
          }
        });
      } else {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
          const activeTab = tabs && tabs[0] ? tabs[0] : null;
          if (!activeTab?.id) return reject(new Error('No active tab found to reload'));
          executeReload(activeTab.id);
        });
      }
    });
  }

  if (command === 'CLOSE_TAB') {
    const explicitTabId = payload?.tabId ? Number(payload.tabId) : undefined;
    const matchUrl = payload?.url ? String(payload.url).toLowerCase() : undefined;
    return new Promise((resolve, reject) => {
      const executeClose = (ids: number[]) => {
        chrome.tabs.remove(ids, () => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve({ closed: true, tabIds: ids, count: ids.length });
        });
      };
      if (explicitTabId) {
        executeClose([explicitTabId]);
      } else if (matchUrl) {
        chrome.tabs.query({}, (tabs) => {
          const matched = (tabs || []).filter(
            (t) => t.url?.toLowerCase().includes(matchUrl) || t.title?.toLowerCase().includes(matchUrl)
          );
          const ids = matched.map((t) => t.id!).filter(Boolean);
          if (ids.length === 0) {
            return resolve({ closed: false, message: `No open tab matched '${matchUrl}'` });
          }
          executeClose(ids);
        });
      } else {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
          const activeTab = tabs && tabs[0] ? tabs[0] : null;
          if (!activeTab?.id) return reject(new Error('No active tab found to close'));
          executeClose([activeTab.id]);
        });
      }
    });
  }

  if (command === 'OPEN_TAB') {
    const rawUrl = payload?.url;
    if (!rawUrl) throw new Error('url is required for open_tab');
    let url = String(rawUrl).trim();
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://') && !url.startsWith('chrome://') && !url.startsWith('about:')) {
      if (url.includes('meet.google.com') || url.includes('localhost') || url.includes('.com') || url.includes('.org') || url.includes('.net') || url.includes('.ir') || url.includes('.io') || url.includes('.app')) {
        url = 'https://' + url;
      }
    }
    const active = payload.active !== false;
    const pinned = !!payload.pinned;
    return new Promise((resolve, reject) => {
      chrome.tabs.create({ url, active, pinned }, (tab) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve({
          opened: true,
          tabId: tab.id,
          windowId: tab.windowId,
          url: tab.url || url,
          title: tab.title || 'New Tab',
          active: tab.active,
          status: tab.status,
        });
      });
    });
  }

  if (command === 'LIST_EXTENSIONS') {
    return new Promise((resolve, reject) => {
      if (!chrome.management?.getAll) return reject(new Error('chrome.management API not available'));
      chrome.management.getAll((extensions) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        const list = (extensions || []).map((e) => ({
          id: e.id,
          name: e.name,
          version: e.version,
          description: e.description,
          enabled: e.enabled,
          installType: e.installType,
          isApp: e.isApp,
          homepageUrl: e.homepageUrl,
          permissions: e.permissions,
        }));
        resolve({ totalExtensions: list.length, extensions: list });
      });
    });
  }

  if (command === 'SET_EXTENSION_ENABLED') {
    const extId = payload?.extensionId;
    const enabled = Boolean(payload?.enabled);
    if (!extId) throw new Error('extensionId is required for SET_EXTENSION_ENABLED');
    return new Promise((resolve, reject) => {
      if (!chrome.management?.setEnabled) return reject(new Error('chrome.management API not available'));
      chrome.management.setEnabled(extId, enabled, () => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message || `Failed to set enabled state for ${extId}`));
        resolve({
          success: true,
          extensionId: extId,
          enabled,
          message: `Extension ${extId} successfully ${enabled ? 'enabled' : 'disabled'}.`
        });
      });
    });
  }

  if (command === 'TOGGLE_EXTENSION') {
    const extId = payload?.extensionId;
    if (!extId) throw new Error('extensionId is required for TOGGLE_EXTENSION');
    return new Promise((resolve, reject) => {
      if (!chrome.management?.get || !chrome.management?.setEnabled) return reject(new Error('chrome.management API not available'));
      chrome.management.get(extId, (ext) => {
        if (chrome.runtime.lastError || !ext) return reject(new Error(chrome.runtime.lastError?.message || `Extension ${extId} not found`));
        const newEnabled = !ext.enabled;
        chrome.management.setEnabled(extId, newEnabled, () => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message || `Failed to toggle ${extId}`));
          resolve({
            success: true,
            extensionId: extId,
            enabled: newEnabled,
            name: ext.name,
            message: `Extension ${ext.name} (${extId}) toggled to ${newEnabled ? 'enabled' : 'disabled'}.`
          });
        });
      });
    });
  }

  // === MCPDOM v3: viewport control via chrome.windows (real browser) ===
  if (command === 'RESIZE_VIEWPORT') {
    const width = Math.max(200, Math.min(7680, Number(payload?.width) || 1280));
    const height = Math.max(200, Math.min(4320, Number(payload?.height) || 800));
    return new Promise((resolve, reject) => {
      chrome.windows.getCurrent({ populate: false }, (win) => {
        if (chrome.runtime.lastError || !win) {
          return reject(new Error(chrome.runtime.lastError?.message || 'No current window'));
        }
        chrome.windows.update(win.id ?? chrome.windows.WINDOW_ID_CURRENT, { width, height, state: 'normal' }, (updated) => {
          if (chrome.runtime.lastError || !updated) {
            return reject(new Error(chrome.runtime.lastError?.message || 'Window resize failed'));
          }
          resolve({
            success: true,
            applied: { width: updated.width, height: updated.height },
            previous: { width: win.width, height: win.height },
            original: { width: win.width, height: win.height },
            reversible: true,
            mode: 'browser-window',
            note: 'Reset with reset_viewport — the content script tracks the original size.',
          });
        });
      });
    });
  }

  if (command === 'RESET_VIEWPORT') {
    return new Promise((resolve, reject) => {
      chrome.windows.getCurrent({ populate: false }, (win) => {
        if (chrome.runtime.lastError || !win) {
          return reject(new Error(chrome.runtime.lastError?.message || 'No current window'));
        }
        chrome.windows.update(win.id ?? chrome.windows.WINDOW_ID_CURRENT, { state: 'maximized' }, (updated) => {
          if (chrome.runtime.lastError || !updated) {
            return reject(new Error(chrome.runtime.lastError?.message || 'Window restore failed'));
          }
          resolve({ success: true, applied: { width: updated.width, height: updated.height }, previous: { width: win.width, height: win.height }, original: { width: updated.width, height: updated.height }, reversible: false, mode: 'browser-window', note: 'Window restored to maximized state.' });
        });
      });
    });
  }

  if (command === 'RELOAD_EXTENSION') {
    const extId = payload?.extensionId;
    const currentExtId = chrome.runtime.id;
    if (!extId || extId === currentExtId) {
      setTimeout(() => chrome.runtime.reload(), 150);
      return { reloaded: true, extensionId: currentExtId, isSelf: true, message: 'Forensic Recorder extension is reloading now.' };
    }
    return new Promise((resolve, reject) => {
      if (!chrome.management?.setEnabled) return reject(new Error('chrome.management API not available'));
      chrome.management.setEnabled(extId, false, () => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message || `Failed to disable ${extId}`));
        setTimeout(() => {
          chrome.management.setEnabled(extId, true, () => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message || `Failed to re-enable ${extId}`));
            resolve({ reloaded: true, extensionId: extId, isSelf: false, message: `Extension ${extId} successfully reloaded.` });
          });
        }, 150);
      });
    });
  }

  // ------------------------------------------------------------------
  // CDP GATEWAY (§9/§8) — Chrome DevTools Protocol access through
  // chrome.debugger. Powers the dt_ performance / memory / debugging
  // capability families. Minimal, justified manifest change: the
  // "debugger" permission (see manifest.json).
  // ------------------------------------------------------------------
  if (command === 'CDP_ATTACH') {
    const tabId = payload?.tabId !== undefined ? Number(payload.tabId) : (await getActiveTabId());
    if (tabId === null) throw new Error('No target tab available for CDP attach.');
    return new Promise((resolve, reject) => {
      if (!(chrome as any).debugger?.attach) {
        return reject(new Error('CDP_UNAVAILABLE: chrome.debugger API not available (check the "debugger" permission).'));
      }
      (chrome as any).debugger.attach({ tabId }, '1.3', () => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || '';
          if (errMsg.includes('Another debugger is already attached')) {
            return reject(new Error(`CDP_ATTACH failed: Chrome DevTools (F12) is already open on tab ${tabId}. Please close the F12 panel on that tab so TeleDOM can attach.`));
          }
          return reject(new Error(`CDP_ATTACH failed: ${errMsg}`));
        }
        // Bind the gateway session to this tab (used by CDP_COMMAND/DETACH).
        if (payload?.sessionId) cdpTargetsBySession.set(String(payload.sessionId), tabId);
        // Resolve the real CDP target id for the unified page identity.
        (chrome as any).debugger.getTargets((targets: any[]) => {
          const target = (targets || []).find((t) => t.tabId === tabId) || {};
          resolve({ attached: true, sessionId: payload?.sessionId, tabId, targetId: target.id || `tab_${tabId}`, type: target.type || 'page' });
        });
      });
    });
  }

  if (command === 'CDP_COMMAND') {
    const { sessionId, method, params } = payload || {};
    if (!method) throw new Error('CDP_COMMAND requires method');
    return new Promise((resolve, reject) => {
      if (!(chrome as any).debugger?.sendCommand) {
        return reject(new Error('CDP_UNAVAILABLE: chrome.debugger API not available (check the "debugger" permission).'));
      }
      // Target resolution: CDP gateway sessions are tab-scoped; the tab is
      // recorded at attach time in cdpTargetsBySession.
      const tabId = cdpTargetsBySession.get(sessionId);
      if (tabId === undefined) {
        return reject(new Error(`CDP_SESSION_NOT_FOUND: no tab bound to session '${sessionId}' — attach first.`));
      }
      (chrome as any).debugger.sendCommand({ tabId }, method, params || {}, (result: any) => {
        if (chrome.runtime.lastError) {
          resolve({ __cdpError: true, code: 'CDP_PROTOCOL_ERROR', message: chrome.runtime.lastError.message, method });
          return;
        }
        resolve({ result: result ?? {} });
      });
    });
  }

  if (command === 'CDP_DETACH') {
    const { sessionId } = payload || {};
    const tabId = cdpTargetsBySession.get(sessionId);
    cdpTargetsBySession.delete(sessionId);
    if (tabId === undefined) return { detached: false, reason: 'session not found' };
    return new Promise((resolve, reject) => {
      if (!(chrome as any).debugger?.detach) return resolve({ detached: false, reason: 'chrome.debugger unavailable' });
      (chrome as any).debugger.detach({ tabId }, () => {
        if (chrome.runtime.lastError) return resolve({ detached: false, reason: chrome.runtime.lastError.message });
        resolve({ detached: true, sessionId, tabId });
      });
    });
  }


  throw new Error(`Unsupported background command: ${command}`);
}

// Connect & maintain WebSocket bridge for live commands and streaming
function connectBridge() {
  if (typeof WebSocket === 'undefined') return;
  try {
    const ws = new WebSocket('ws://127.0.0.1:3847');
    let heartbeatTimer: any = null;
    ws.onopen = () => {
      wsBridge = ws;
      console.log('[Forensic Extension] Connected to MCP Bridge on ws://127.0.0.1:3847');
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }
      ws.send(
        JSON.stringify({
          type: 'REGISTER_CLIENT',
          clientType: 'SERVICE_WORKER',
          url: typeof chrome !== 'undefined' && chrome.runtime?.id ? `chrome-extension://${chrome.runtime.id}` : 'service-worker',
          title: 'Forensic Service Worker',
        })
      );
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: 'HEARTBEAT', timestamp: Date.now() }));
          } catch (err: any) {
            console.warn('[TeleDOM SW] non-critical operation failed:', err?.message ?? err);
          }
        }
      }, 15000);
    };

    ws.onclose = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      wsBridge = null;
      ensureReconnect();
    };

    ws.onerror = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      wsBridge = null;
      ensureReconnect();
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data.toString());

        // Dispatch live browser command
        if (message.type === 'BROWSER_COMMAND_REQUEST') {
          const { id, command, payload } = message;

          if (typeof chrome === 'undefined' || !chrome.tabs) {
            ws.send(
              JSON.stringify({
                type: 'BROWSER_COMMAND_RESPONSE',
                id,
                command,
                success: false,
                error: { code: 'NO_CHROME_TABS_API', message: 'chrome.tabs API not available in this context' },
              })
            );
            return;
          }

          // 1. Handle background-level tab & extension commands
          if (['LIST_TABS', 'FOCUS_TAB', 'RELOAD_TAB', 'CLOSE_TAB', 'OPEN_TAB', 'LIST_EXTENSIONS', 'RELOAD_EXTENSION', 'SET_EXTENSION_ENABLED', 'TOGGLE_EXTENSION', 'CDP_ATTACH', 'CDP_COMMAND', 'CDP_DETACH'].includes(command)) {
            try {
              const data = await executeBackgroundCommand(command, payload);
              ws.send(
                JSON.stringify({
                  type: 'BROWSER_COMMAND_RESPONSE',
                  id,
                  command,
                  success: true,
                  data,
                })
              );
            } catch (cmdErr: any) {
              ws.send(
                JSON.stringify({
                  type: 'BROWSER_COMMAND_RESPONSE',
                  id,
                  command,
                  success: false,
                  error: { code: 'COMMAND_ERROR', message: cmdErr.message },
                })
              );
            }
            return;
          }

          // 2. Tab target resolution (explicit tabId vs active tab)
          const explicitTabId = payload?.tabId ? Number(payload.tabId) : undefined;

          const dispatchToTab = (tabId: number) => {
            // Screenshot commands
            if (command === 'LIVE_PAGE_SCREENSHOT' || command === 'LIVE_ELEMENT_SCREENSHOT') {
              chrome.tabs.sendMessage(tabId, { type: 'HIDE_FORENSIC_OVERLAYS' }, () => {
                setTimeout(() => {
                  chrome.tabs.captureVisibleTab({ format: 'png' }, (dataUrl) => {
                    chrome.tabs.sendMessage(tabId, { type: 'RESTORE_FORENSIC_OVERLAYS' });

                    if (chrome.runtime.lastError || !dataUrl) {
                      ws.send(
                        JSON.stringify({
                          type: 'BROWSER_COMMAND_RESPONSE',
                          id,
                          command,
                          success: false,
                          error: {
                            code: 'SCREENSHOT_FAILED',
                            message: chrome.runtime.lastError?.message || 'captureVisibleTab failed',
                          },
                        })
                      );
                      return;
                    }

                    chrome.tabs.sendMessage(
                      tabId,
                      {
                        type: 'BROWSER_COMMAND_REQUEST',
                        id,
                        command,
                        payload: { ...payload, dataUrl },
                      },
                      (res) => {
                        const response = res || {
                          id,
                          command,
                          success: true,
                          data: { dataUrl, captureType: command === 'LIVE_ELEMENT_SCREENSHOT' ? 'ELEMENT' : 'FULL_PAGE' },
                        };
                        ws.send(JSON.stringify({ type: 'BROWSER_COMMAND_RESPONSE', ...response }));
                      }
                    );
                  });
                }, 150);
              });
              return;
            }

            // General live commands
            chrome.tabs.sendMessage(tabId, message, (res) => {
              if (chrome.runtime.lastError) {
                ws.send(
                  JSON.stringify({
                    type: 'BROWSER_COMMAND_RESPONSE',
                    id,
                    command,
                    success: false,
                    error: {
                      code: 'CONTENT_SCRIPT_UNREACHABLE',
                      message: chrome.runtime.lastError.message || `Content script unreachable on tab ${tabId}`,
                    },
                  })
                );
                return;
              }
              ws.send(JSON.stringify({ type: 'BROWSER_COMMAND_RESPONSE', ...(res || { id, command, success: true }) }));
            });
          };

          if (explicitTabId) {
            dispatchToTab(explicitTabId);
          } else {
            chrome.tabs.query({ active: true, lastFocusedWindow: true }, async (tabs) => {
              const activeTab = tabs && tabs[0] ? tabs[0] : null;
              const tabId = activeTab?.id;

              if (!tabId) {
                ws.send(
                  JSON.stringify({
                    type: 'BROWSER_COMMAND_RESPONSE',
                    id,
                    command,
                    success: false,
                    error: { code: 'NO_ACTIVE_TAB', message: 'No active browser tab found' },
                  })
                );
                return;
              }

              dispatchToTab(tabId);
            });
          }
        }
      } catch (err: any) {
        console.error('[ServiceWorker] Bridge message handling error:', err);
      }
    };
  } catch {
    wsBridge = null;
    ensureReconnect();
  }
}

function ensureReconnect() {
  if (!reconnectTimer) {
    reconnectTimer = setInterval(() => {
      if (!wsBridge || wsBridge.readyState !== WebSocket.OPEN) {
        connectBridge();
      }
    }, 5000);
  }
}

// Manifest V3 Service Worker Keep-Alive via chrome.alarms (prevents 30s idle termination)
if (typeof chrome !== 'undefined' && chrome.alarms) {
  try {
    chrome.alarms.create('teledom_bridge_keepalive', { periodInMinutes: 0.4 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'teledom_bridge_keepalive') {
        if (!wsBridge || wsBridge.readyState !== WebSocket.OPEN) {
          connectBridge();
        } else {
          try {
            wsBridge.send(JSON.stringify({ type: 'HEARTBEAT', timestamp: Date.now() }));
          } catch {
            connectBridge();
          }
        }
      }
    });
  } catch (err: any) {
    console.warn('[ServiceWorker] Alarms keepalive setup failed:', err?.message);
  }
}

// Start bridge connection
connectBridge();

// WebNavigation listener to capture reload, back, forward, and link navigations
if (typeof chrome !== 'undefined' && chrome.webNavigation?.onCommitted) {
  chrome.webNavigation.onCommitted.addListener(async (details) => {
    if (details.frameId !== 0) return;

    const tabId = details.tabId;
    const active = activeTabRecordings.get(tabId);
    if (!active || !active.isRecording) return;

    let navType: 'NAV_RELOAD' | 'NAV_FORWARD_BACK' | 'NAV_LINK' | 'NAV_OTHER' = 'NAV_OTHER';
    if (details.transitionType === 'reload') navType = 'NAV_RELOAD';
    else if (details.transitionQualifiers?.includes('forward_back')) navType = 'NAV_FORWARD_BACK';
    else if (details.transitionType === 'link') navType = 'NAV_LINK';

    const navEvent: BaseEvent = {
      id: `nav_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sessionId: active.sessionId,
      timestamp: Date.now() - active.startTime,
      sequence: 999999,
      wallClockTime: Date.now(),
      type: navType as any,
      category: 'NAVIGATION',
      source: 'USER_INTERACTION',
      payload: {
        url: details.url,
        transitionType: details.transitionType,
        transitionQualifiers: details.transitionQualifiers,
        tabId: details.tabId,
      },
    };

    try {
      await storage.appendEvents(active.sessionId, [navEvent]);
      if (wsBridge && wsBridge.readyState === WebSocket.OPEN) {
        wsBridge.send(JSON.stringify({ type: 'FORENSIC_EVENTS_CHUNK', sessionId: active.sessionId, events: [navEvent] }));
      }
    } catch {
      // Ignored
    }
  });
}

// Handle runtime messages
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        const tabId = sender.tab?.id ?? message.tabId;

        if (message.type === 'FORENSIC_SESSION_START') {
          if (tabId) {
            activeTabRecordings.set(tabId, {
              sessionId: message.metadata.id,
              sessionName: message.metadata.name,
              startTime: message.metadata.startTime,
              initialUrl: message.metadata.url,
              isRecording: true,
            });
          }

          await storage.saveSession(message.metadata);
          if (message.initialSnapshot) {
            await storage.saveInitialSnapshot(message.metadata.id, message.initialSnapshot);
          }

          if (wsBridge && wsBridge.readyState === WebSocket.OPEN) {
            wsBridge.send(JSON.stringify(message));
          }

          sendResponse({ success: true, sessionId: message.metadata.id });
        } else if (message.type === 'GET_TAB_RECORDING_STATE') {
          const active = tabId ? activeTabRecordings.get(tabId) : null;
          sendResponse({
            isRecording: !!active?.isRecording,
            recording: active || null,
          });
        } else if (message.type === 'FORENSIC_EVENTS_CHUNK') {
          await storage.appendEvents(message.sessionId, message.events);

          if (wsBridge && wsBridge.readyState === WebSocket.OPEN) {
            wsBridge.send(JSON.stringify(message));
          }

          sendResponse({ success: true });
        } else if (message.type === 'FORENSIC_CHECKPOINT') {
          await storage.saveCheckpoint(message.checkpoint);

          if (wsBridge && wsBridge.readyState === WebSocket.OPEN) {
            wsBridge.send(JSON.stringify(message));
          }

          sendResponse({ success: true });
        } else if (message.type === 'FORENSIC_SESSION_STOP') {
          if (tabId) {
            activeTabRecordings.delete(tabId);
          }

          const session = await storage.getSession(message.sessionId);
          if (session) {
            session.status = 'stopped';
            session.endTime = Date.now();
            if (message.metadata?.durationMs) {
              session.durationMs = message.metadata.durationMs;
            }
            await storage.saveSession(session);
          }

          if (wsBridge && wsBridge.readyState === WebSocket.OPEN) {
            wsBridge.send(JSON.stringify(message));
          }

          sendResponse({ success: true });
        } else if (message.type === 'OPEN_DASHBOARD_TAB') {
          const url = chrome.runtime.getURL(`dist/src/ui/index.html${message.sessionId ? `?session=${message.sessionId}` : ''}`);
          chrome.tabs.create({ url });
          sendResponse({ success: true, url });
        } else if (message.type === 'CAPTURE_SCREENSHOT') {
          if (chrome.tabs?.captureVisibleTab) {
            chrome.tabs.captureVisibleTab({ format: 'png' }, (dataUrl) => {
              sendResponse({ success: !!dataUrl, dataUrl });
            });
            return;
          }
          sendResponse({ success: false, error: 'Screenshot capture unsupported' });
        } else if (message.type === 'ELEMENT_SELECTED') {
          if (wsBridge && wsBridge.readyState === WebSocket.OPEN) {
            wsBridge.send(JSON.stringify(message));
          }
          sendResponse({ success: true });
        } else if (message.type === 'BROWSER_COMMAND_REQUEST') {
          try {
            const data = await executeBackgroundCommand(message.command, message.payload);
            sendResponse({ id: message.id, command: message.command, success: true, data });
          } catch (cmdErr: any) {
            sendResponse({ id: message.id, command: message.command, success: false, error: { code: 'COMMAND_ERROR', message: cmdErr.message } });
          }
        }
      } catch (err: any) {
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  });
}

// Auto-connect to MCP Bridge WebSocket on startup
connectBridge();
