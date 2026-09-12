import fs from 'fs';
import path from 'path';
import { LiveBrowserController } from '../core/live-browser-controller';
import { BrowserCommandType } from '../types/browser-control';
import { MCPToolCallResult } from '../types/mcp-types';

export interface BrowserBridgeClient {
  sendCommand(command: BrowserCommandType, payload?: any): Promise<any>;
}

export class LiveToolsHandler {
  private localController: LiveBrowserController;
  private bridgeClient?: BrowserBridgeClient;

  constructor(localController?: LiveBrowserController, bridgeClient?: BrowserBridgeClient) {
    this.localController = localController || new LiveBrowserController();
    this.bridgeClient = bridgeClient;
  }

  public setBridgeClient(client: BrowserBridgeClient): void {
    this.bridgeClient = client;
  }

  public getLocalController(): LiveBrowserController {
    return this.localController;
  }

  public async handleToolCall(name: string, args: Record<string, any>): Promise<MCPToolCallResult> {
    try {
      switch (name) {
        case 'list_tabs':
          return await this.handleListTabs(args);

        case 'focus_tab':
          return await this.handleFocusTab(args);

        case 'reload_tab':
          return await this.handleReloadTab(args);

        case 'close_tab':
          return await this.handleCloseTab(args);

        case 'open_tab':
          return await this.handleOpenTab(args);

        case 'list_extensions':
          return await this.handleListExtensions(args);

        case 'reload_extension':
          return await this.handleReloadExtension(args);

        case 'set_extension_enabled':
          return await this.handleSetExtensionEnabled(args);

        case 'toggle_extension':
          return await this.handleToggleExtension(args);

        case 'execute_pipeline':
          return await this.handleExecutePipeline(args);

        case 'compare_extension_states':
          return await this.handleCompareExtensionStates(args);

        case 'get_tab_console_logs':
          return await this.handleGetTabConsoleLogs(args);

        case 'get_tab_network_requests':
          return await this.handleGetTabNetworkRequests(args);

        case 'inspect_live_page':
          return await this.handleInspectLivePage(args);

        case 'inspect_live_element':
          return await this.handleInspectLiveElement(args);

        case 'get_selected_element':
          return await this.handleGetSelectedElement(args);

        case 'start_element_picker':
          return await this.handleStartElementPicker(args);

        case 'stop_element_picker':
          return await this.handleStopElementPicker(args);

        case 'capture_page_screenshot':
          return await this.handleCapturePageScreenshot(args);

        case 'capture_element_screenshot':
          return await this.handleCaptureElementScreenshot(args);

        case 'interact_with_element':
          return await this.handleInteractWithElement(args);

        case 'start_element_observation':
          return await this.handleStartElementObservation(args);

        case 'stop_element_observation':
          return await this.handleStopElementObservation(args);

        case 'get_live_dom_snapshot':
          return await this.handleGetLiveDOMSnapshot(args);

        case 'get_live_dom_subtree':
          return await this.handleGetLiveDOMSubtree(args);

        case 'get_element_visual_state':
          return await this.handleGetElementVisualState(args);

        default:
          return {
            isError: true,
            content: [{ type: 'text', text: `Unknown live tool: ${name}` }],
          };
      }
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Live tool execution error in '${name}': ${err.message}` }],
      };
    }
  }

  private saveToFile(filePath: string, data: string | Buffer): { saved: boolean; outputPath: string; sizeBytes: number } {
    const resolvedPath = path.resolve(filePath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolvedPath, data);
    const stats = fs.statSync(resolvedPath);
    return {
      saved: true,
      outputPath: resolvedPath.replace(/\\/g, '/'),
      sizeBytes: stats.size,
    };
  }

  private async dispatch(command: BrowserCommandType, payload?: any): Promise<any> {
    if (this.bridgeClient) {
      try {
        return await this.bridgeClient.sendCommand(command, payload);
      } catch (bridgeErr: any) {
        if (typeof document !== 'undefined' || typeof window !== 'undefined') {
          const doc = typeof document !== 'undefined' ? document : undefined;
          const req = {
            id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            command,
            timestamp: Date.now(),
            payload,
          };
          const res = await this.localController.handleCommand(req, doc);
          if (res.success) {
            return res.data;
          }
          // §83/§84: never mask the local failure behind the bridge error —
          // surface BOTH causes so agents can diagnose the real problem.
          const localCode = res.error?.code || 'LOCAL_COMMAND_FAILED';
          const localMessage = res.error?.message || 'unknown local error';
          const combined = new Error(
            `${bridgeErr.message} | local fallback also failed: [${localCode}] ${localMessage}`
          );
          (combined as any).code = localCode;
          (combined as any).bridgeError = bridgeErr.message;
          throw combined;
        }
        throw bridgeErr;
      }
    }
    const doc = typeof document !== 'undefined' ? document : undefined;
    const req = {
      id: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      command,
      timestamp: Date.now(),
      payload,
    };
    const res = await this.localController.handleCommand(req, doc);
    if (!res.success) {
      throw new Error(res.error?.message || 'Browser command failed');
    }
    return res.data;
  }

  // 1. inspect_live_page
  private async handleInspectLivePage(args: Record<string, any>): Promise<MCPToolCallResult> {
    const data = await this.dispatch('LIVE_PAGE_INSPECT', args);
    if (args.outputPath) {
      const saveInfo = this.saveToFile(args.outputPath, JSON.stringify(data, null, 2));
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...saveInfo, ...data }, null, 2) }],
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // 2. inspect_live_element
  private async handleInspectLiveElement(args: Record<string, any>): Promise<MCPToolCallResult> {
    const target = this.extractTarget(args);
    const data = await this.dispatch('LIVE_ELEMENT_INSPECT', target);
    if (args.outputPath) {
      const saveInfo = this.saveToFile(args.outputPath, JSON.stringify(data, null, 2));
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...saveInfo, ...data }, null, 2) }],
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // 3. get_selected_element
  private async handleGetSelectedElement(_args: Record<string, any>): Promise<MCPToolCallResult> {
    let data = this.localController.getPicker().getLastSelectedElement();
    if (!data) {
      try {
        data = await this.dispatch('GET_SELECTED_ELEMENT');
      } catch {
        // Fallback
      }
    }
    if (!data) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                selected: false,
                message: 'No element has been selected yet. Use Ctrl + Shift + Click in the browser or call start_element_picker.',
              },
              null,
              2
            ),
          },
        ],
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify({ selected: true, element: data }, null, 2) }],
    };
  }

  // 4. start_element_picker
  private async handleStartElementPicker(args: Record<string, any>): Promise<MCPToolCallResult> {
    const data = await this.dispatch('ELEMENT_PICKER_START', args);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'PICKER_ACTIVE',
              message: 'Visual element picker activated in the browser. Click any element or hold Ctrl+Shift and click.',
              details: data,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // 5. stop_element_picker
  private async handleStopElementPicker(args: Record<string, any>): Promise<MCPToolCallResult> {
    const data = await this.dispatch('ELEMENT_PICKER_STOP', args);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'PICKER_INACTIVE',
              message: 'Visual element picker stopped.',
              details: data,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // 6. capture_page_screenshot
  private async handleCapturePageScreenshot(args: Record<string, any>): Promise<MCPToolCallResult> {
    const data = await this.dispatch('LIVE_PAGE_SCREENSHOT', args);
    if (args.outputPath && data?.dataUrl) {
      try {
        const parts = data.dataUrl.split(',');
        const base64Data = parts.length > 1 ? parts[1] : parts[0];
        const buffer = Buffer.from(base64Data, 'base64');
        const saveInfo = this.saveToFile(args.outputPath, buffer);
        const { dataUrl, ...rest } = data;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ...saveInfo,
                  ...rest,
                  message: `Screenshot successfully captured and saved to ${saveInfo.outputPath}`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to save screenshot to ${args.outputPath}: ${err.message}` }],
        };
      }
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // 7. capture_element_screenshot
  private async handleCaptureElementScreenshot(args: Record<string, any>): Promise<MCPToolCallResult> {
    const target = this.extractTarget(args);
    const data = await this.dispatch('LIVE_ELEMENT_SCREENSHOT', target);
    if (args.outputPath && data?.dataUrl) {
      try {
        const parts = data.dataUrl.split(',');
        const base64Data = parts.length > 1 ? parts[1] : parts[0];
        const buffer = Buffer.from(base64Data, 'base64');
        const saveInfo = this.saveToFile(args.outputPath, buffer);
        const { dataUrl, ...rest } = data;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ...saveInfo,
                  ...rest,
                  message: `Element screenshot saved to ${saveInfo.outputPath}`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to save element screenshot: ${err.message}` }],
        };
      }
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // 8. interact_with_element
  private async handleInteractWithElement(args: Record<string, any>): Promise<MCPToolCallResult> {
    const target = this.extractTarget(args);
    const action = args.action || 'click';
    const payload = {
      action,
      target,
      text: args.text,
      key: args.key,
      optionValue: args.optionValue,
      scrollDelta: args.scrollDelta,
      options: {
        waitForStabilization: args.waitForStabilization !== false,
        stabilizationTimeoutMs: args.stabilizationTimeoutMs || 300,
        captureScreenshots: args.captureScreenshots || false,
      },
    };

    const data = await this.dispatch('LIVE_ELEMENT_INTERACT', payload);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // 9. start_element_observation
  private async handleStartElementObservation(args: Record<string, any>): Promise<MCPToolCallResult> {
    const target = this.extractTarget(args);
    const data = await this.dispatch('ELEMENT_OBSERVATION_START', target);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'OBSERVATION_ACTIVE',
              message: 'Focused observation started around target element.',
              initialState: data.initialState,
              observationId: data.observationId,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // 10. stop_element_observation
  private async handleStopElementObservation(args: Record<string, any>): Promise<MCPToolCallResult> {
    const data = await this.dispatch('ELEMENT_OBSERVATION_STOP', args);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // 11. get_live_dom_snapshot
  private async handleGetLiveDOMSnapshot(args: Record<string, any>): Promise<MCPToolCallResult> {
    const data = await this.dispatch('LIVE_DOM_SNAPSHOT', args);
    const htmlContent = typeof data?.html === 'string' ? data.html : (typeof data === 'string' ? data : JSON.stringify(data, null, 2));

    if (args.outputPath) {
      try {
        const saveInfo = this.saveToFile(args.outputPath, htmlContent);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ...saveInfo,
                  url: data?.url,
                  title: data?.title,
                  nodeCount: data?.nodeCount,
                  message: `Live DOM snapshot saved to ${saveInfo.outputPath}`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to save DOM snapshot to ${args.outputPath}: ${err.message}` }],
        };
      }
    }

    if (typeof data?.html === 'string') {
      return { content: [{ type: 'text', text: data.html }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }

  // 12. get_live_dom_subtree
  private async handleGetLiveDOMSubtree(args: Record<string, any>): Promise<MCPToolCallResult> {
    const target = this.extractTarget(args);
    const data = await this.dispatch('LIVE_DOM_SUBTREE', target);
    const htmlContent = typeof data?.html === 'string' ? data.html : (typeof data === 'string' ? data : JSON.stringify(data, null, 2));

    if (args.outputPath) {
      try {
        const saveInfo = this.saveToFile(args.outputPath, htmlContent);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ...saveInfo,
                  selector: data?.selector,
                  targetNodeId: data?.targetNodeId,
                  message: `Live DOM subtree saved to ${saveInfo.outputPath}`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to save DOM subtree to ${args.outputPath}: ${err.message}` }],
        };
      }
    }

    if (typeof data?.html === 'string') {
      return { content: [{ type: 'text', text: data.html }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }

  // 13. get_element_visual_state
  private async handleGetElementVisualState(args: Record<string, any>): Promise<MCPToolCallResult> {
    const target = this.extractTarget(args);
    const data = await this.dispatch('GET_ELEMENT_VISUAL_STATE', target);
    if (args.outputPath) {
      const saveInfo = this.saveToFile(args.outputPath, JSON.stringify(data, null, 2));
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...saveInfo, ...data }, null, 2) }],
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // 14. list_tabs
  private async handleListTabs(args: Record<string, any>): Promise<MCPToolCallResult> {
    const data = await this.dispatch('LIST_TABS', args);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // 15. focus_tab
  private async handleFocusTab(args: Record<string, any>): Promise<MCPToolCallResult> {
    const data = await this.dispatch('FOCUS_TAB', args);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // 16. reload_tab
  private async handleReloadTab(args: Record<string, any>): Promise<MCPToolCallResult> {
    const data = await this.dispatch('RELOAD_TAB', args);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // 16b. close_tab
  private async handleCloseTab(args: Record<string, any>): Promise<MCPToolCallResult> {
    const data = await this.dispatch('CLOSE_TAB', args);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // 16c. open_tab
  private async handleOpenTab(args: Record<string, any>): Promise<MCPToolCallResult> {
    const data = await this.dispatch('OPEN_TAB', args);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // 17. list_extensions
  private async handleListExtensions(args: Record<string, any>): Promise<MCPToolCallResult> {
    const data = await this.dispatch('LIST_EXTENSIONS', args);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // 18. reload_extension
  private async handleReloadExtension(args: Record<string, any>): Promise<MCPToolCallResult> {
    const data = await this.dispatch('RELOAD_EXTENSION', args);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // 18b. set_extension_enabled
  private async handleSetExtensionEnabled(args: Record<string, any>): Promise<MCPToolCallResult> {
    const extId = args.extensionId;
    const enabled = Boolean(args.enabled);
    if (!extId) {
      return { isError: true, content: [{ type: 'text', text: 'extensionId is required' }] };
    }
    const data = await this.dispatch('SET_EXTENSION_ENABLED', { extensionId: extId, enabled });
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // 18c. toggle_extension
  private async handleToggleExtension(args: Record<string, any>): Promise<MCPToolCallResult> {
    const extId = args.extensionId;
    if (!extId) {
      return { isError: true, content: [{ type: 'text', text: 'extensionId is required' }] };
    }
    const data = await this.dispatch('TOGGLE_EXTENSION', { extensionId: extId });
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // 18d. execute_pipeline
  private async handleExecutePipeline(args: Record<string, any>): Promise<MCPToolCallResult> {
    const steps = Array.isArray(args.steps) ? args.steps : [];
    if (steps.length === 0) {
      return { isError: true, content: [{ type: 'text', text: 'Pipeline must contain at least one step in "steps" array.' }] };
    }

    const startTime = Date.now();
    const results: any[] = [];
    let pipelineSuccess = true;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepStartTime = Date.now();
      const action = step.action;
      const params = step.params || {};
      const stopOnError = step.stopOnError !== false;

      try {
        if (action === 'wait' || action === 'sleep' || action === 'delay') {
          const durationMs = Number(params.durationMs || params.delayMs || params.timeoutMs || 1000);
          await new Promise((resolve) => setTimeout(resolve, durationMs));
          results.push({
            stepIndex: i,
            id: step.id,
            action,
            success: true,
            durationMs: Date.now() - stepStartTime,
            result: { waitedMs: durationMs },
          });
        } else {
          const toolRes = await this.handleToolCall(action, params);
          const durationMs = Date.now() - stepStartTime;

          let parsedResult: any = null;
          try {
            const firstItem = toolRes.content?.[0] as any;
            if (firstItem && typeof firstItem.text === 'string') {
              parsedResult = JSON.parse(firstItem.text);
            }
          } catch {
            const firstItem = toolRes.content?.[0] as any;
            parsedResult = firstItem?.text;
          }

          const isErr = !!toolRes.isError;
          results.push({
            stepIndex: i,
            id: step.id,
            action,
            success: !isErr,
            durationMs,
            result: parsedResult,
            error: isErr ? (typeof parsedResult === 'string' ? parsedResult : JSON.stringify(parsedResult)) : undefined,
          });

          if (isErr && stopOnError) {
            pipelineSuccess = false;
            break;
          }
        }
      } catch (stepErr: any) {
        pipelineSuccess = false;
        results.push({
          stepIndex: i,
          id: step.id,
          action,
          success: false,
          durationMs: Date.now() - stepStartTime,
          error: stepErr.message || String(stepErr),
        });
        if (stopOnError) {
          break;
        }
      }
    }

    const finalSummary = {
      pipelineSuccess,
      totalSteps: steps.length,
      executedSteps: results.length,
      durationMs: Date.now() - startTime,
      steps: results,
    };

    if (args.outputPath) {
      try {
        const saveInfo = this.saveToFile(args.outputPath, JSON.stringify(finalSummary, null, 2));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ...saveInfo, ...finalSummary }, null, 2),
            },
          ],
        };
      } catch (saveErr: any) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ...finalSummary,
                fileSaveError: `Failed to write pipeline output to ${args.outputPath}: ${saveErr?.message || saveErr}`,
              }, null, 2),
            },
          ],
        };
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(finalSummary, null, 2) }],
    };
  }

  // 18e. compare_extension_states
  private async handleCompareExtensionStates(args: Record<string, any>): Promise<MCPToolCallResult> {
    const extId = args.extensionId;
    if (!extId) {
      return { isError: true, content: [{ type: 'text', text: 'extensionId is required for compare_extension_states' }] };
    }

    const tabId = args.tabId;
    const waitMs = Number(args.waitDurationMs || 2500);
    const cleanDomPath = args.cleanDomPath;
    const injectedDomPath = args.injectedDomPath;
    const cleanScreenshotPath = args.cleanScreenshotPath;
    const injectedScreenshotPath = args.injectedScreenshotPath;
    const diffOutputPath = args.diffOutputPath;

    // 1. Disable extension
    await this.dispatch('SET_EXTENSION_ENABLED', { extensionId: extId, enabled: false });

    // 2. Reload tab clean
    await this.dispatch('RELOAD_TAB', { tabId, bypassCache: true });
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    // 3. Capture Clean DOM
    const cleanDomRes = await this.dispatch('LIVE_DOM_SNAPSHOT', { tabId });
    const cleanHtml = typeof cleanDomRes?.html === 'string' ? cleanDomRes.html : JSON.stringify(cleanDomRes);
    if (cleanDomPath) {
      this.saveToFile(cleanDomPath, cleanHtml);
    }

    // 4. Capture Clean Screenshot
    if (cleanScreenshotPath) {
      const cleanShotRes = await this.dispatch('LIVE_PAGE_SCREENSHOT', { tabId });
      if (cleanShotRes?.dataUrl) {
        const parts = cleanShotRes.dataUrl.split(',');
        const buf = Buffer.from(parts.length > 1 ? parts[1] : parts[0], 'base64');
        this.saveToFile(cleanScreenshotPath, buf);
      }
    }

    // 5. Enable extension
    await this.dispatch('SET_EXTENSION_ENABLED', { extensionId: extId, enabled: true });

    // 6. Reload tab injected
    await this.dispatch('RELOAD_TAB', { tabId, bypassCache: true });
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    // 7. Capture Injected DOM
    const injectedDomRes = await this.dispatch('LIVE_DOM_SNAPSHOT', { tabId });
    const injectedHtml = typeof injectedDomRes?.html === 'string' ? injectedDomRes.html : JSON.stringify(injectedDomRes);
    if (injectedDomPath) {
      this.saveToFile(injectedDomPath, injectedHtml);
    }

    // 8. Capture Injected Screenshot
    if (injectedScreenshotPath) {
      const injectedShotRes = await this.dispatch('LIVE_PAGE_SCREENSHOT', { tabId });
      if (injectedShotRes?.dataUrl) {
        const parts = injectedShotRes.dataUrl.split(',');
        const buf = Buffer.from(parts.length > 1 ? parts[1] : parts[0], 'base64');
        this.saveToFile(injectedScreenshotPath, buf);
      }
    }

    // 9. Compare HTML and detect injected artifacts
    const injectedMarkers = ['annota', 'workspace', 'shadow-root', 'history-tree', 'knowledge-hub', 'codex'];
    const detectedMarkers = injectedMarkers.filter(
      (m) => injectedHtml.toLowerCase().includes(m) && !cleanHtml.toLowerCase().includes(m)
    );

    const comparisonReport = {
      comparisonSuccess: true,
      extensionId: extId,
      tabId: tabId || 'active',
      cleanState: {
        domPath: cleanDomPath,
        screenshotPath: cleanScreenshotPath,
        domLengthChars: cleanHtml.length,
      },
      injectedState: {
        domPath: injectedDomPath,
        screenshotPath: injectedScreenshotPath,
        domLengthChars: injectedHtml.length,
      },
      analysis: {
        domSizeDifferenceChars: injectedHtml.length - cleanHtml.length,
        injectedMarkersDetected: detectedMarkers,
        summary: `Comparison complete. Clean DOM: ${cleanHtml.length} chars, Injected DOM: ${injectedHtml.length} chars (Delta: ${
          injectedHtml.length - cleanHtml.length
        } chars). Detected injected markers: ${detectedMarkers.join(', ') || 'none'}.`,
      },
    };

    if (diffOutputPath) {
      this.saveToFile(diffOutputPath, JSON.stringify(comparisonReport, null, 2));
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(comparisonReport, null, 2) }],
    };
  }

  // 19. get_tab_console_logs
  private async handleGetTabConsoleLogs(args: Record<string, any>): Promise<MCPToolCallResult> {
    const data = await this.dispatch('GET_TAB_CONSOLE_LOGS', args);
    if (args.outputPath) {
      const saveInfo = this.saveToFile(args.outputPath, JSON.stringify(data, null, 2));
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...saveInfo, totalLogs: Array.isArray(data) ? data.length : data?.logs?.length }, null, 2) }],
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // 20. get_tab_network_requests
  private async handleGetTabNetworkRequests(args: Record<string, any>): Promise<MCPToolCallResult> {
    const data = await this.dispatch('GET_TAB_NETWORK_REQUESTS', args);
    if (args.outputPath) {
      const saveInfo = this.saveToFile(args.outputPath, JSON.stringify(data, null, 2));
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...saveInfo, totalRequests: Array.isArray(data) ? data.length : data?.requests?.length }, null, 2) }],
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  private extractTarget(args: Record<string, any>): any {
    let target: any = {};
    if (args.target) target = { ...args.target };
    else if (args.selector) target = { selector: args.selector };
    else if (typeof args.nodeId === 'number') target = { nodeId: args.nodeId };
    else if (args.selectedElementRef) target = { selectedElementRef: args.selectedElementRef };
    else if (args.xpath) target = { xpath: args.xpath };
    else if (args.coordinates) target = { coordinates: args.coordinates };
    else target = { ...args };

    if (typeof args.tabId === 'number') {
      target.tabId = args.tabId;
    }
    return target;
  }
}
