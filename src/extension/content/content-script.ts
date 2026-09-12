import { ForensicRecorder } from '../../core/recorder';
import { LiveBrowserController } from '../../core/live-browser-controller';
import { BaseEvent } from '../../types/events';
import { InPageFloatingController } from './floating-controller';

(function () {
  let recorder: ForensicRecorder | null = null;
  const liveController = new LiveBrowserController();
  let eventBatch: BaseEvent[] = [];
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let floatingController: InPageFloatingController | null = null;
  let isInspectModeActive = false;

  const MAX_LIVE_BUFFER = 500;
  const liveConsoleLogs: any[] = [];
  const liveNetworkRequests: any[] = [];

  // Continuous listener to window messages from page-script
  window.addEventListener('message', (e) => {
    if (e.data?._forensicOrigin === 'PAGE_MAIN') {
      const { type, payload } = e.data;
      if (type === 'CONSOLE_ENTRY') {
        liveConsoleLogs.push(payload);
        if (liveConsoleLogs.length > MAX_LIVE_BUFFER) liveConsoleLogs.shift();
      } else if (type === 'NETWORK_ENTRY') {
        const existingIdx = liveNetworkRequests.findIndex((r) => r.requestId === payload.requestId);
        if (existingIdx >= 0) {
          liveNetworkRequests[existingIdx] = { ...liveNetworkRequests[existingIdx], ...payload };
        } else {
          liveNetworkRequests.push(payload);
          if (liveNetworkRequests.length > MAX_LIVE_BUFFER) liveNetworkRequests.shift();
        }
      }
    }
  });

  function injectPageScript() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('dist/extension/page-script.js');
        script.onload = () => script.remove();
        (document.head || document.documentElement).appendChild(script);
      }
    } catch {
      // Ignored
    }
  }

  function flushEvents() {
    if (eventBatch.length === 0 || !recorder) return;
    const eventsToSend = [...eventBatch];
    eventBatch = [];

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'FORENSIC_EVENTS_CHUNK',
          sessionId: recorder.getSessionId(),
          events: eventsToSend,
        });
      }
    } catch {
      // Background worker might be idle
    }
  }

  function startRecording(sessionName?: string, existingSessionId?: string, startTime?: number) {
    if (recorder) return recorder.getMetadata();

    recorder = new ForensicRecorder({
      sessionId: existingSessionId,
      sessionName: sessionName || `Recording on ${document.title || window.location.hostname}`,
    });

    recorder.onEvent((event) => {
      eventBatch.push(event);
      if (floatingController) {
        floatingController.incrementEventCount();
      }
      if (eventBatch.length >= 25) {
        flushEvents();
      }
    });

    recorder.onCheckpoint((checkpoint) => {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            type: 'FORENSIC_CHECKPOINT',
            sessionId: checkpoint.sessionId,
            checkpoint,
          });
        }
      } catch {
        // Ignored
      }
    });

    const initialSnapshot = recorder.start(document);

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'FORENSIC_SESSION_START',
          metadata: recorder.getMetadata(),
          initialSnapshot,
        });
      }
    } catch {
      // Ignored
    }

    if (!flushTimer) {
      flushTimer = setInterval(flushEvents, 1000);
    }

    if (floatingController) {
      floatingController.updateState(true, false, startTime || Date.now(), 0);
    }

    return recorder.getMetadata();
  }

  function stopRecording() {
    if (!recorder) return null;

    flushEvents();
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }

    const metadata = recorder.stop();

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'FORENSIC_SESSION_STOP',
          sessionId: metadata.id,
          metadata,
        });
      }
    } catch {
      // Ignored
    }

    const stoppedMeta = { ...metadata };
    recorder = null;

    if (floatingController) {
      floatingController.updateState(false, false, 0, 0);
    }

    return stoppedMeta;
  }

  function toggleInspectMode() {
    if (isInspectModeActive) {
      isInspectModeActive = false;
      document.body.style.cursor = 'default';
      return;
    }

    isInspectModeActive = true;
    document.body.style.cursor = 'crosshair';

    const overlay = document.createElement('div');
    overlay.id = 'forensic-inspect-highlighter';
    overlay.style.position = 'fixed';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2147483640';
    overlay.style.border = '2px dashed #38bdf8';
    overlay.style.background = 'rgba(56, 189, 248, 0.15)';
    overlay.style.transition = 'all 0.05s ease';
    document.body.appendChild(overlay);

    const onHover = (e: MouseEvent) => {
      if (!isInspectModeActive) return;
      const target = e.target as HTMLElement;
      if (!target || target.id === 'forensic-recorder-floating-host' || target.closest('#forensic-recorder-floating-host')) {
        overlay.style.display = 'none';
        return;
      }

      const rect = target.getBoundingClientRect();
      overlay.style.display = 'block';
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
    };

    const onClick = (e: MouseEvent) => {
      if (!isInspectModeActive) return;
      const target = e.target as HTMLElement;
      if (target.closest('#forensic-recorder-floating-host')) return;

      e.preventDefault();
      e.stopPropagation();

      isInspectModeActive = false;
      document.body.style.cursor = 'default';
      overlay.remove();
      window.removeEventListener('mousemove', onHover, true);
      window.removeEventListener('click', onClick, true);

      if (recorder) {
        const selector = target.id ? `#${target.id}` : target.className ? `.${target.className.split(' ')[0]}` : target.tagName.toLowerCase();
        recorder.addAnnotation('Inspect Element', `Inspected element <${target.tagName.toLowerCase()}> with selector '${selector}'`, 'USER');
        alert(`🎯 Inspected element <${target.tagName.toLowerCase()}> recorded! Checkpoint saved.`);
      }
    };

    window.addEventListener('mousemove', onHover, true);
    window.addEventListener('click', onClick, true);
  }

  function getOrCreateFloatingController(): InPageFloatingController {
    if (!floatingController) {
      floatingController = new InPageFloatingController({
        onStartRecord: () => {
          startRecording();
        },
        onStopRecord: () => {
          stopRecording();
        },
        onTogglePause: () => {
          if (recorder) {
            recorder.getMetadata().status === 'recording' ? recorder.pause() : recorder.resume();
          }
        },
        onCaptureCheckpoint: () => {
          if (recorder) {
            recorder.captureCheckpoint('MANUAL', document);
          }
        },
        onAddAnnotation: (text) => {
          if (recorder) {
            recorder.addAnnotation('User Note', text, 'USER');
          }
        },
        onInspectElement: () => {
          toggleInspectMode();
        },
        onOpenDashboard: () => {
          const sessId = recorder ? recorder.getSessionId() : undefined;
          chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD_TAB', sessionId: sessId });
        },
      });
    }
    return floatingController;
  }

  // Check if this tab is currently in an active recording session (e.g. across page reloads/nav)
  function initAutoReconnect() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'GET_TAB_RECORDING_STATE' }, (res) => {
          if (chrome.runtime.lastError || !res) return;

          if (res.isRecording && res.recording) {
            const controller = getOrCreateFloatingController();
            controller.mount();

            // Auto-continue recording seamlessly
            startRecording(res.recording.sessionName, res.recording.sessionId, res.recording.startTime);
          }
        });
      }
    } catch {
      // Ignored
    }
  }

  // Handle messages from Popup, Background, or Live MCP Bridge
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'HIDE_FORENSIC_OVERLAYS') {
        if (floatingController) {
          floatingController.hide();
        }
        const hosts = document.querySelectorAll('#forensic-recorder-floating-host, #forensic-inspect-highlighter, [id^="forensic-"]');
        hosts.forEach((el) => {
          const htmlEl = el as HTMLElement;
          htmlEl.style.setProperty('display', 'none', 'important');
          htmlEl.style.setProperty('visibility', 'hidden', 'important');
          htmlEl.style.setProperty('opacity', '0', 'important');
        });
        sendResponse({ success: true });
        return true;
      } else if (message.type === 'RESTORE_FORENSIC_OVERLAYS') {
        if (floatingController) {
          floatingController.show();
        }
        const hosts = document.querySelectorAll('#forensic-recorder-floating-host, #forensic-inspect-highlighter, [id^="forensic-"]');
        hosts.forEach((el) => {
          const htmlEl = el as HTMLElement;
          htmlEl.style.removeProperty('display');
          htmlEl.style.removeProperty('visibility');
          htmlEl.style.removeProperty('opacity');
        });
        sendResponse({ success: true });
        return true;
      } else if (message.type === 'BROWSER_COMMAND_REQUEST') {
        if (['LIST_TABS', 'FOCUS_TAB', 'RELOAD_TAB', 'LIST_EXTENSIONS', 'RELOAD_EXTENSION', 'CLOSE_TAB', 'OPEN_TAB', 'RESIZE_VIEWPORT', 'RESET_VIEWPORT'].includes(message.command)) {
          // Ignore background-level commands intended exclusively for the service worker
          return false;
        }

        if (message.command === 'GET_TAB_CONSOLE_LOGS') {
          const { level, searchQuery, limit = 100, clearAfterRead } = message.payload || {};
          let logs = [...liveConsoleLogs];
          if (level && level !== 'all') {
            logs = logs.filter((l) => l.level === level);
          }
          if (searchQuery) {
            const q = String(searchQuery).toLowerCase();
            logs = logs.filter((l) => l.text?.toLowerCase().includes(q) || l.source?.toLowerCase().includes(q));
          }
          if (limit > 0) {
            logs = logs.slice(-limit);
          }
          if (clearAfterRead) {
            liveConsoleLogs.length = 0;
          }
          sendResponse({
            id: message.id,
            command: message.command,
            success: true,
            data: {
              url: window.location.href,
              title: document.title,
              totalCaptured: liveConsoleLogs.length,
              returnedCount: logs.length,
              logs,
            },
          });
          return true;
        }

        if (message.command === 'GET_TAB_NETWORK_REQUESTS') {
          const { method, searchQuery, status, onlyErrors, limit = 100, clearAfterRead } = message.payload || {};
          let reqs = [...liveNetworkRequests];
          if (method) {
            reqs = reqs.filter((r) => r.method?.toUpperCase() === String(method).toUpperCase());
          }
          if (status) {
            reqs = reqs.filter((r) => r.status === Number(status));
          }
          if (onlyErrors) {
            reqs = reqs.filter((r) => r.error || (r.status && r.status >= 400));
          }
          if (searchQuery) {
            const q = String(searchQuery).toLowerCase();
            reqs = reqs.filter((r) => r.url?.toLowerCase().includes(q));
          }
          if (limit > 0) {
            reqs = reqs.slice(-limit);
          }
          if (clearAfterRead) {
            liveNetworkRequests.length = 0;
          }
          sendResponse({
            id: message.id,
            command: message.command,
            success: true,
            data: {
              url: window.location.href,
              title: document.title,
              totalCaptured: liveNetworkRequests.length,
              returnedCount: reqs.length,
              requests: reqs,
            },
          });
          return true;
        }

        liveController.handleCommand(message, document).then((res) => {
          sendResponse(res);
        });
        return true;
      } else if (message.type === 'START_RECORDING') {
        const meta = startRecording(message.sessionName);
        const controller = getOrCreateFloatingController();
        controller.mount();
        sendResponse({ success: true, metadata: meta });
      } else if (message.type === 'STOP_RECORDING') {
        const meta = stopRecording();
        sendResponse({ success: true, metadata: meta });
      } else if (message.type === 'TOGGLE_FLOATING_OVERLAY') {
        const controller = getOrCreateFloatingController();
        if (document.getElementById('forensic-recorder-floating-host')) {
          controller.unmount();
          sendResponse({ isOpen: false });
        } else {
          controller.mount();
          controller.updateState(recorder?.getMetadata().status === 'recording', false, recorder?.getMetadata().startTime || 0, 0);
          sendResponse({ isOpen: true });
        }
      } else if (message.type === 'GET_RECORDER_STATUS') {
        sendResponse({
          isRecording: recorder?.getMetadata().status === 'recording',
          metadata: recorder?.getMetadata() || null,
        });
      } else if (message.type === 'CAPTURE_CHECKPOINT') {
        if (recorder) {
          const checkpoint = recorder.captureCheckpoint('MANUAL', document);
          sendResponse({ success: true, checkpoint });
        } else {
          sendResponse({ success: false, error: 'Not currently recording' });
        }
      }
      return true;
    });
  }

  // Initialize injected page script
  injectPageScript();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutoReconnect);
  } else {
    initAutoReconnect();
  }
})();
