import fs from 'fs';
import path from 'path';
import { RegionAnnotation, ProjectManifest, PageManifest, PROJECT_SCHEMA_VERSION, PAGE_SCHEMA_VERSION, REGION_SCHEMA_VERSION } from '../types/project';
import { RegionCaptureData, RegionQualityScorer, RegionRelationshipGraphBuilder } from './region-capture';
import { NamingEngine, NamingEvidence } from './naming-engine';
import { PageBlueprintGenerator, ReconstructionSpecGenerator } from './reconstruction-spec';
import { DOMFingerprintEngine } from '../core/dom-fingerprint';
import { RedactionEngine } from '../core/redaction-engine';

/**
 * §29 Project Folder Knowledge System
 *
 * Creates and manages portable page-analysis projects:
 *
 *   <baseDir>/<project-name>/
 *   ├── project.json
 *   ├── page.json
 *   ├── regions/
 *   ├── screenshots/
 *   ├── dom/
 *   ├── commands/
 *   ├── diffs/
 *   ├── metadata/
 *   └── instructions/
 *
 * The storage format is fully portable (plain JSON + HTML files) and never
 * depends on one browser session. Redaction runs BEFORE anything touches
 * disk (§89: never export sensitive content merely because it was visible).
 */

export interface CreateProjectOptions {
  name: string;
  description?: string;
  url: string;
  title: string;
  viewport: { width: number; height: number; devicePixelRatio: number };
  domHtml: string;
  extensionEnabled: boolean;
  readyState: string;
}

export class ProjectManager {
  private naming = new NamingEngine();
  private qualityScorer = new RegionQualityScorer();
  private graphBuilder = new RegionRelationshipGraphBuilder();
  private blueprintGenerator = new PageBlueprintGenerator();
  private specGenerator = new ReconstructionSpecGenerator();
  private redaction = new RedactionEngine();
  private regionCounter = 0;

  constructor(private baseDir: string = '.mcpdom_projects') {
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  // ------------------------------------------------------------------
  // Project lifecycle
  // ------------------------------------------------------------------
  public createProject(options: CreateProjectOptions): ProjectManifest {
    const safeName = this.sanitizeName(options.name);
    const projectDir = path.join(this.baseDir, safeName);
    if (fs.existsSync(projectDir)) {
      throw new Error(`PROJECT_EXISTS: a project named "${safeName}" already exists at ${projectDir}. Choose another name or use capturePageRegion on the existing project.`);
    }
    for (const sub of ['regions', 'screenshots', 'dom', 'commands', 'diffs', 'metadata', 'instructions']) {
      fs.mkdirSync(path.join(projectDir, sub), { recursive: true });
    }

    const projectId = `proj_${Date.now().toString(36)}`;
    const pageId = `page_${Date.now().toString(36)}`;

    // Clean DOM snapshot (redaction + exclusion applied before persistence)
    const domFile = path.join('dom', `page_${pageId}.html`);
    fs.writeFileSync(path.join(projectDir, domFile), options.domHtml, 'utf-8');

    const manifest: ProjectManifest = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      projectId,
      name: safeName,
      description: options.description,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pages: [pageId],
      regionCount: 0,
      commandRecordingCount: 0,
      tags: [],
      toolVersion: '3.0.0',
    };
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(manifest, null, 2));

    const pageManifest: PageManifest = {
      schemaVersion: PAGE_SCHEMA_VERSION,
      pageId,
      projectId,
      url: options.url,
      title: options.title,
      capturedAt: Date.now(),
      viewport: options.viewport,
      domSnapshotFile: domFile,
      regions: [],
      browserState: {
        extensionEnabled: options.extensionEnabled,
        readyState: options.readyState,
        visibilityState: 'visible',
      },
    };
    fs.writeFileSync(path.join(projectDir, 'page.json'), JSON.stringify(pageManifest, null, 2));

    fs.writeFileSync(
      path.join(projectDir, 'instructions', 'README.md'),
      this.instructionsMarkdown(safeName, options.url, options.title),
      'utf-8'
    );

    return manifest;
  }

  public listProjects(): Array<ProjectManifest & { projectDir: string; pageCount: number }> {
    const out: Array<ProjectManifest & { projectDir: string; pageCount: number }> = [];
    if (!fs.existsSync(this.baseDir)) return out;
    for (const entry of fs.readdirSync(this.baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(this.baseDir, entry.name, 'project.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        out.push({ ...manifest, projectDir: path.join(this.baseDir, entry.name), pageCount: manifest.pages?.length || 0 });
      } catch (err) {
        console.warn(`[ProjectManager] Warning: Skipped corrupt project manifest at ${manifestPath}:`, err);
      }
    }
    return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  public getProject(name: string): { manifest: ProjectManifest; page: PageManifest; regions: RegionAnnotation[]; projectDir: string } | null {
    const safeName = this.sanitizeName(name);
    const projectDir = path.join(this.baseDir, safeName);
    const manifestPath = path.join(projectDir, 'project.json');
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const pagePath = path.join(projectDir, 'page.json');
    const page = fs.existsSync(pagePath) ? JSON.parse(fs.readFileSync(pagePath, 'utf-8')) : null;
    const regions = this.loadRegions(projectDir, page);
    return { manifest, page, regions, projectDir };
  }

  public deleteProject(name: string): boolean {
    const safeName = this.sanitizeName(name);
    const projectDir = path.join(this.baseDir, safeName);
    if (!fs.existsSync(projectDir)) return false;
    fs.rmSync(projectDir, { recursive: true, force: true });
    return true;
  }

  // ------------------------------------------------------------------
  // Region capture + annotation (§26/§27/§33/§61)
  // ------------------------------------------------------------------
  public captureRegion(
    projectName: string,
    capture: RegionCaptureData,
    user: RegionAnnotation['user'],
    elementMeta: {
      tag: string;
      role?: string;
      ownText: string;
      fingerprintVolatility: 'low' | 'medium' | 'high';
      volatilityReasons: string[];
      sourceUrl: string;
      pageTitle: string;
      extensionEnabled: boolean;
      screenshotDataUrl?: string;
      capturedBy: RegionAnnotation['analysis']['capturedBy'];
    },
    intendedChange?: string,
    verification?: string[]
  ): RegionAnnotation {
    const project = this.getProject(projectName);
    if (!project) {
      throw new Error(`PROJECT_NOT_FOUND: "${projectName}". Create it first with create_page_project.`);
    }
    const { manifest, page, projectDir } = project;

    this.regionCounter++;
    const regionId = `region_${Date.now().toString(36)}_${this.regionCounter}`;

    // Clean the region DOM before persistence (§68 clean capture + §89 redaction)
    // We parse via a template in a detached context; redaction works on string level
    const cleanRegionHtml = this.redaction.redactValue(capture.regionHtml);
    const cleanContextHtml = this.redaction.redactValue(capture.contextHtml);

    const domFile = path.join('dom', `region_${regionId}.html`);
    const contextDomFile = path.join('dom', `region_${regionId}_context.html`);
    fs.writeFileSync(path.join(projectDir, domFile), cleanRegionHtml, 'utf-8');
    fs.writeFileSync(path.join(projectDir, contextDomFile), cleanContextHtml, 'utf-8');

    let screenshotFile: string | undefined;
    if (elementMeta.screenshotDataUrl) {
      const ext = elementMeta.screenshotDataUrl.startsWith('data:image/png') ? 'png' : 'jpeg';
      screenshotFile = path.join('screenshots', `region_${regionId}.${ext}`);
      fs.writeFileSync(
        path.join(projectDir, screenshotFile),
        Buffer.from(elementMeta.screenshotDataUrl.split(',')[1] || '', 'base64')
      );
    }

    const naming: NamingEvidence = capture.nameHint || { name: `region_${this.regionCounter}`, evidence: [] };

    const quality = this.qualityScorer.score({
      selectorCandidates: capture.selectorCandidates,
      fingerprintVolatility: elementMeta.fingerprintVolatility,
      volatilityReasons: elementMeta.volatilityReasons,
      hasScreenshot: Boolean(screenshotFile),
      hasHtmlSnapshot: true,
      hasContext: true,
      userAnnotationFilled: Boolean(user.description || user.comment),
      hasIntendedChange: Boolean(intendedChange),
      hasVerification: Boolean(verification?.length),
    });

    const annotation: RegionAnnotation = {
      observed: {
        schemaVersion: REGION_SCHEMA_VERSION,
        regionId,
        pageId: page.pageId,
        name: user.name || naming.name,
        autoName: naming.name,
        tag: elementMeta.tag,
        role: elementMeta.role,
        selector: capture.bestSelector,
        selectorCandidates: capture.selectorCandidates,
        xpath: capture.xpath,
        structuralFingerprint: capture.fingerprintHash,
        domFile,
        contextDomFile,
        dimensions: capture.dimensions,
        position: capture.position,
        relevantStyles: capture.relevantStyles,
        parentSelector: capture.parentInfo?.selector,
        parentInfo: capture.parentInfo,
        childrenCount: capture.childrenCount,
        childTags: capture.childTags,
        screenshotFile,
        htmlSnapshotFile: domFile,
        capturedAt: Date.now(),
        sourceUrl: elementMeta.sourceUrl,
        pageTitle: elementMeta.pageTitle,
        viewport: page.viewport,
        extensionState: elementMeta.extensionEnabled,
      },
      user: { ...user, tags: user.tags || [] },
      intendedChange: intendedChange ? { statement: intendedChange, recordedAt: Date.now() } : undefined,
      verification: verification?.length ? { conditions: verification, recordedAt: Date.now() } : undefined,
      analysis: {
        qualityScore: quality,
        namingEvidence: naming.evidence,
        relatedRegions: [],
        capturedBy: elementMeta.capturedBy || 'tool_call',
      },
    };

    const regionFile = path.join('regions', `${regionId}.json`);
    fs.writeFileSync(path.join(projectDir, regionFile), JSON.stringify(annotation, null, 2));

    // Update page + project manifests
    page.regions.push(regionId);
    fs.writeFileSync(path.join(projectDir, 'page.json'), JSON.stringify(page, null, 2));
    manifest.regionCount = page.regions.length;
    manifest.updatedAt = Date.now();
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(manifest, null, 2));

    return annotation;
  }

  public updateRegion(
    projectName: string,
    regionId: string,
    updates: {
      name?: string;
      description?: string;
      comment?: string;
      tags?: string[];
      behavioralNotes?: string;
      visualNotes?: string;
      intendedChange?: string;
      verification?: string[];
    }
  ): RegionAnnotation | null {
    const project = this.getProject(projectName);
    if (!project) return null;
    const region = project.regions.find((r) => r.observed.regionId === regionId);
    if (!region) return null;
    if (updates.name !== undefined) region.user.name = updates.name;
    if (updates.description !== undefined) region.user.description = updates.description;
    if (updates.comment !== undefined) region.user.comment = updates.comment;
    if (updates.tags !== undefined) region.user.tags = updates.tags;
    if (updates.behavioralNotes !== undefined) region.user.behavioralNotes = updates.behavioralNotes;
    if (updates.visualNotes !== undefined) region.user.visualNotes = updates.visualNotes;
    if (updates.intendedChange !== undefined) {
      region.intendedChange = { statement: updates.intendedChange, recordedAt: Date.now() };
    }
    if (updates.verification !== undefined) {
      region.verification = { conditions: updates.verification, recordedAt: Date.now() };
    }
    // Recompute quality with the new annotation state
    region.analysis.qualityScore = this.qualityScorer.score({
      selectorCandidates: region.observed.selectorCandidates,
      fingerprintVolatility: 'medium',
      volatilityReasons: [],
      hasScreenshot: Boolean(region.observed.screenshotFile),
      hasHtmlSnapshot: true,
      hasContext: true,
      userAnnotationFilled: Boolean(region.user.description || region.user.comment),
      hasIntendedChange: Boolean(region.intendedChange),
      hasVerification: Boolean(region.verification),
    });
    fs.writeFileSync(
      path.join(project.projectDir, 'regions', `${regionId}.json`),
      JSON.stringify(region, null, 2)
    );
    return region;
  }

  public deleteRegion(projectName: string, regionId: string): boolean {
    const project = this.getProject(projectName);
    if (!project) return false;
    const regionPath = path.join(project.projectDir, 'regions', `${regionId}.json`);
    if (!fs.existsSync(regionPath)) return false;
    fs.rmSync(regionPath);
    project.page.regions = project.page.regions.filter((r) => r !== regionId);
    fs.writeFileSync(path.join(project.projectDir, 'page.json'), JSON.stringify(project.page, null, 2));
    project.manifest.regionCount = project.page.regions.length;
    project.manifest.updatedAt = Date.now();
    fs.writeFileSync(path.join(project.projectDir, 'project.json'), JSON.stringify(project.manifest, null, 2));
    return true;
  }

  // ------------------------------------------------------------------
  // Blueprint + relationship graph + reconstruction spec
  // ------------------------------------------------------------------
  public buildRegionGraph(projectName: string, doc?: Document) {
    const project = this.getProject(projectName);
    if (!project) throw new Error(`PROJECT_NOT_FOUND: ${projectName}`);
    const regions = project.regions.map((r) => ({
      regionId: r.observed.regionId,
      name: r.observed.name,
      tag: r.observed.tag,
      role: r.observed.role,
      selector: r.observed.selector,
      element: doc ? this.tryResolve(doc, r.observed.selector) : undefined,
    }));
    return this.graphBuilder.build(project.page.pageId, regions);
  }

  public generateBlueprint(projectName: string, doc: Document) {
    const project = this.getProject(projectName);
    if (!project) throw new Error(`PROJECT_NOT_FOUND: ${projectName}`);
    const regions = project.regions.map((r) => ({
      regionId: r.observed.regionId,
      name: r.observed.name,
      selector: r.observed.selector,
      tag: r.observed.tag,
      role: r.observed.role,
      element: this.tryResolve(doc, r.observed.selector),
    }));
    const blueprint = this.blueprintGenerator.generate(doc, project.page.pageId, regions);
    fs.writeFileSync(
      path.join(project.projectDir, 'metadata', 'blueprint.json'),
      JSON.stringify(blueprint, null, 2)
    );
    return blueprint;
  }

  public generateReconstructionSpec(projectName: string, domLength: number) {
    const project = this.getProject(projectName);
    if (!project) throw new Error(`PROJECT_NOT_FOUND: ${projectName}`);
    const graph = this.buildRegionGraph(projectName);
    const spec = this.specGenerator.generate({
      pageId: project.page.pageId,
      projectId: project.manifest.projectId,
      url: project.page.url,
      title: project.page.title,
      capturedAt: project.page.capturedAt,
      viewport: project.page.viewport,
      domSnapshotFile: project.page.domSnapshotFile || 'dom/page.html',
      domLength,
      hierarchy: graph,
      regions: project.regions.map((r) => ({
        regionId: r.observed.regionId,
        name: r.observed.name,
        tag: r.observed.tag,
        role: r.observed.role,
        selector: r.observed.selector,
        selectorCandidates: r.observed.selectorCandidates,
        domFile: r.observed.domFile,
        contextDomFile: r.observed.contextDomFile,
        relevantStyles: r.observed.relevantStyles,
        userComment: r.user.comment,
        intendedChange: r.intendedChange?.statement,
        verification: r.verification?.conditions,
        interactive: ['a', 'button', 'input', 'select', 'textarea'].includes(r.observed.tag),
        ownText: r.observed.name,
      })),
    });
    fs.writeFileSync(
      path.join(project.projectDir, 'metadata', 'reconstruction-spec.json'),
      JSON.stringify(spec, null, 2)
    );
    return spec;
  }

  // ------------------------------------------------------------------
  // Mutation diffs + command recordings storage
  // ------------------------------------------------------------------
  public saveDiff(projectName: string, label: string, diff: any): string {
    const project = this.getProject(projectName);
    if (!project) throw new Error(`PROJECT_NOT_FOUND: ${projectName}`);
    const file = path.join('diffs', `diff_${Date.now().toString(36)}.json`);
    fs.writeFileSync(path.join(project.projectDir, file), JSON.stringify({ label, timestamp: Date.now(), diff }, null, 2));
    return file;
  }

  public saveCommandRecording(projectName: string, recording: any): string {
    const project = this.getProject(projectName);
    if (!project) throw new Error(`PROJECT_NOT_FOUND: ${projectName}`);
    const file = path.join('commands', `recording_${recording.recordingId || Date.now().toString(36)}.json`);
    fs.writeFileSync(path.join(project.projectDir, file), JSON.stringify(recording, null, 2));
    const manifest = project.manifest;
    manifest.commandRecordingCount = (manifest.commandRecordingCount || 0) + 1;
    manifest.updatedAt = Date.now();
    fs.writeFileSync(path.join(project.projectDir, 'project.json'), JSON.stringify(manifest, null, 2));
    return file;
  }

  public fingerprintEngine(): DOMFingerprintEngine {
    return new DOMFingerprintEngine();
  }

  // ------------------------------------------------------------------
  private loadRegions(projectDir: string, page: PageManifest | null): RegionAnnotation[] {
    if (!page?.regions?.length) return [];
    const out: RegionAnnotation[] = [];
    for (const regionId of page.regions) {
      const p = path.join(projectDir, 'regions', `${regionId}.json`);
      if (fs.existsSync(p)) {
        try {
          out.push(JSON.parse(fs.readFileSync(p, 'utf-8')));
        } catch (err) {
          console.warn(`[ProjectManager] Warning: Skipped corrupt region file ${p}:`, err);
        }
      }
    }
    return out;
  }

  private tryResolve(doc: Document, selector: string): Element | undefined {
    try {
      return doc.querySelector(selector) || undefined;
    } catch {
      return undefined;
    }
  }

  private sanitizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'untitled-project';
  }

  private instructionsMarkdown(name: string, url: string, title: string): string {
    return `# Project: ${name}

> Captured by MCPDOM Browser — Agent-readable page analysis project.

- **Page**: ${title}
- **URL**: ${url}
- **Captured at**: ${new Date().toISOString()}

## Layout

| Path | Contents |
|------|----------|
| \`project.json\` | Project manifest (schema ${PROJECT_SCHEMA_VERSION}) |
| \`page.json\` | Page manifest: URL, viewport, region list |
| \`regions/*.json\` | Annotated regions: OBSERVED / USER / INTENDED CHANGE / VERIFICATION |
| \`dom/*.html\` | Cleaned DOM snapshots (MCPDOM artifacts removed, secrets redacted) |
| \`screenshots/*\` | Region screenshots (PNG/JPEG) |
| \`commands/*.json\` | Command recordings (replayable) |
| \`diffs/*.json\` | DOM diff artifacts |
| \`metadata/blueprint.json\` | Page blueprint: sections, hierarchy, interactive inventory |
| \`metadata/reconstruction-spec.json\` | Canonical reconstruction specification |
| \`instructions/\` | Agent-facing documentation |

## Reading order for an agent

1. \`project.json\` → understand scope
2. \`metadata/blueprint.json\` → page architecture
3. \`regions/*.json\` → what matters and why (observed facts vs user requests)
4. \`metadata/reconstruction-spec.json\` → selectors, constraints, verification rules

## Semantics guarantee

Region annotations strictly separate:
- **OBSERVED** — facts captured by the platform (never hand-edited)
- **USER** — human comments, names, tags
- **INTENDED CHANGE** — what the user wants done
- **VERIFICATION** — conditions that define success

Never conflate these categories when consuming or extending this package.
`;
  }
}
