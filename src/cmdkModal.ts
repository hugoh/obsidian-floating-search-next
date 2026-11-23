import type { EventRef, SuggestChooser } from "obsidian";
import {
  debounce,
  Keymap,
  moment,
  renderResults,
  type SearchResult,
  SuggestModal,
  setIcon,
  type TFile,
  type WorkspaceLeaf,
} from "obsidian";
import {
  type CmdkResult,
  ephemeralStateFor,
  type FileResult,
  isFileResult,
} from "./cmdkResult";
import { createExclusionMatcher, normalizePath } from "./exclusions";
import {
  compileQueryRegex,
  createTextMatcher,
  getBookmarkedPaths,
  isFileAllowed,
  mountFilterBar,
} from "./filterBar";
import type PaneSearchPlugin from "./paneSearchIndex";
import { strings } from "./i18n";
import { LatestQueue } from "./latestQueue";
import { type EmbeddedView, spawnLeafView } from "./leafView";
import { promptForName } from "./namePrompt";
import { safeFileName, uniqueNotePath } from "./quickCreate";
import {
  firstMatchLine,
  freeText,
  isPlainText,
  parseQuery,
  type Query,
  requiresContent,
  SearchFilter,
} from "./searchFilter";

const formatNow = (format: string): string =>
  (moment as unknown as () => { format(pattern: string): string })().format(
    format,
  );

export class PaneSearchCmdkModal extends SuggestModal<CmdkResult> {
  plugin: PaneSearchPlugin;
  private bodyEl: HTMLElement;
  private isComposing = false;
  private previewEl: HTMLElement | undefined;
  private fileLeaf: WorkspaceLeaf | undefined;
  private fileEmbeddedView: EmbeddedView | undefined;
  private searchAbort: AbortController | null = null;
  private readonly compositionStart = () => {
    this.isComposing = true;
  };
  private readonly compositionEnd = () => {
    this.isComposing = false;
    this.updateSuggestions();
  };
  private closed = false;
  private readonly previews = new LatestQueue();
  private debouncedUpdate = debounce(() => this.runSearch(), 150);
  private activeFilters: string[] = [];
  private filterMatchSets: Map<string, Set<string>> | null = null;
  private searchFilter: SearchFilter;
  private liveQuery: Query = { groups: [] };
  private liveHasContent = false;
  private filterBarEl: HTMLElement;
  // Candidate ③: the scanned + exclusion-filtered candidate file set, built
  // once and reused across keystrokes (invalidated on vault changes).
  private candidateFiles: TFile[] | null = null;
  private vaultRefs: EventRef[] = [];
  // Candidate ⑥: file paths that already passed the metadata pre-filter in
  // runSearch, so the heading phase need not re-evaluate them.
  private passedMeta: Set<string> | null = null;

  constructor(plugin: PaneSearchPlugin, initialFilters?: string[]) {
    super(plugin.app);
    this.plugin = plugin;
    this.limit = 50;
    const s = strings();
    this.setPlaceholder(s.cmdkPlaceholder);
    this.searchFilter = new SearchFilter(this.app);
    this.activeFilters = initialFilters ? [...initialFilters] : [];
    this.setInstructions([
      { command: "↑↓", purpose: s.cmdkNavigate },
      { command: "↵", purpose: s.cmdkOpen },
      { command: "Shift ↵", purpose: s.cmdkNewTab },
      { command: "esc", purpose: s.cmdkClose },
    ]);
    this.modalEl.addClass("pane-search-cmdk");
    this.containerEl.addClass("pane-search-cmdk-container");
  }

  onOpen() {
    this.closed = false;
    void super.onOpen();

    this.isComposing = false;
    // Tab previews the selection on demand; Shift+Tab closes the preview.
    this.scope.register([], "Tab", () => {
      const result = this.selectedResult();
      if (result && isFileResult(result)) void this.showPreview(result);
      return false;
    });
    this.scope.register(["Shift"], "Tab", () => {
      this.hidePreview();
      return false;
    });
    this.inputEl.addEventListener("compositionstart", this.compositionStart);
    this.inputEl.addEventListener("compositionend", this.compositionEnd);
    // Candidate ③: invalidate the cached candidate file set whenever the
    // vault changes, so the next search rebuilds it lazily.
    const invalidate = () => {
      this.candidateFiles = null;
    };
    const { vault } = this.app;
    this.vaultRefs = [
      vault.on("create", invalidate),
      vault.on("modify", invalidate),
      vault.on("rename", invalidate),
      vault.on("delete", invalidate),
    ];
    this.bodyEl = createDiv("pane-search-cmdk-body");
    this.modalEl.insertBefore(this.bodyEl, this.resultContainerEl);
    this.bodyEl.appendChild(this.resultContainerEl);
    const inputWrap = this.inputEl.closest<HTMLElement>(
      ".prompt-input-container",
    );
    if (inputWrap) {
      mountFilterBar(inputWrap, this.plugin, () => this.updateSuggestions());
    }

    // Render filter chip bar as its own horizontal row, above the results body
    this.filterBarEl = this.modalEl.createDiv({
      cls: "pane-search-filter-bar",
    });
    this.modalEl.insertBefore(this.filterBarEl, this.bodyEl);
    this.renderFilterBar();

    // If the modal was opened with presets pre-selected (e.g. via the
    // saved-search command), filter the list immediately.
    if (this.activeFilters.length > 0) {
      this.runSearch();
    }
  }

  // Required by SuggestModal but unused — we drive the chooser directly
  getSuggestions(_query: string): CmdkResult[] {
    return [];
  }

  // Override to use progressive rendering via chooser.addSuggestion
  updateSuggestions() {
    if (this.closed || this.isComposing) return;
    this.onSelectedChange.cancel();
    this.hidePreview();
    this.debouncedUpdate();
  }

  // ── Filter bar ─────────────────────────────────────────────────────
  private renderFilterBar() {
    this.filterBarEl.empty();
    const buttons = this.plugin.settings.savedSearches;
    if (buttons.length === 0) {
      this.filterBarEl.hide();
      return;
    }
    this.filterBarEl.show();

    for (const fb of buttons) {
      const chip = this.filterBarEl.createDiv({
        cls: "pane-search-filter-chip",
        text: fb.name,
      });
      if (this.activeFilters.includes(fb.query)) {
        chip.addClass("is-active");
      }
      chip.onClickEvent(() => {
        // Single-select (mutually exclusive): clicking the active chip
        // clears it; clicking another chip replaces the previous selection.
        if (this.activeFilters.includes(fb.query)) {
          this.activeFilters = [];
        } else {
          this.activeFilters = [fb.query];
        }
        this.renderFilterBar();
        this.runSearch();
      });
    }
  }

  private matchesFilters(file: TFile): boolean {
    if (this.activeFilters.length === 0) return true;
    return this.activeFilters.every(
      (f) => this.filterMatchSets?.get(f)?.has(file.path) ?? false,
    );
  }

  // Candidate ③: build the scanned + exclusion-filtered candidate file set
  // once, normalising the exclusion lists a single time (not per file), and
  // reuse it across keystrokes. Rebuilt lazily after any vault change.
  private getCandidateFiles(): TFile[] {
    if (this.candidateFiles) return this.candidateFiles;
    const isExcluded = createExclusionMatcher(this.plugin.settings);
    const exts = new Set(["md", "canvas", "pdf", "base"]);
    this.candidateFiles = this.app.vault
      .getFiles()
      .filter((f: TFile) => exts.has(f.extension) && !isExcluded(f.path));
    return this.candidateFiles;
  }

  // Precompute, for each active filter query, the set of file paths that
  // match. Delegates to SearchFilter, the single source of truth for all
  // filter matching (tag / path / folder / property / text, with AND across
  // clauses and nested-tag support matching native search).
  private prepareFilterMatchSets(files: TFile[]) {
    this.filterMatchSets = this.searchFilter.buildMatchSets(
      files,
      this.activeFilters,
    );
  }

  private runSearch() {
    // Cancel previous in-flight search
    this.searchAbort?.abort();
    const abort = new AbortController();
    this.searchAbort = abort;
    const { signal } = abort;
    this.passedMeta = null;

    const chooser = this.chooser;
    const rawInput = this.inputEl.value;
    const trimmed = rawInput.trim();

    // Candidate ③: reuse the cached, exclusion-filtered candidate set
    // instead of re-scanning + re-normalising exclusions on every keystroke.
    const bookmarks = this.plugin.settings.filterStarredOnly
      ? getBookmarkedPaths(this.app)
      : null;
    const files = this.getCandidateFiles().filter((f: TFile) =>
      isFileAllowed(this.plugin, f, bookmarks),
    );

    // Precompute filter match sets before filtering
    if (this.activeFilters.length > 0) {
      this.prepareFilterMatchSets(files);
    } else {
      this.filterMatchSets = null;
    }

    // "Save current query" chip (shown when a query is typed and not yet saved)
    const extra: CmdkResult[] = [];
    if (
      trimmed &&
      !this.plugin.settings.savedSearches.some(
        (s) => s.query.trim() === trimmed,
      )
    ) {
      extra.push({ type: "save" });
    }

    // Empty query — show launcher (saved) + recent files, filtered by active chips
    if (!trimmed) {
      const recent = files
        .sort((a: TFile, b: TFile) => b.stat.mtime - a.stat.mtime)
        .filter((f: TFile) => this.matchesFilters(f))
        .slice(0, this.limit)
        .map((file: TFile) => ({
          file,
          nameMatch: null,
          pathMatch: null,
          type: "file" as const,
        }));
      chooser.setSuggestions([...extra, ...recent]);
      return;
    }

    // Parse the live query with the FULL Obsidian Query syntax
    // (tag:/path:/folder:/file:/property:/[key::value] plus line:/block:/
    // section:/content:/task:, -exclusion, "quoted phrases", OR grouping).
    // Metadata clauses are applied synchronously; content clauses
    // (line/block/section/content/task) are evaluated in the async
    // content phase so we don't read every file body on each keystroke.
    const query = parseQuery(trimmed);
    this.liveQuery = query;
    this.liveHasContent = requiresContent(query);
    const pureText = isPlainText(query);
    const fuzzyText = freeText(query);
    const fuzzy = fuzzyText ? createTextMatcher(this.plugin, fuzzyText) : null;
    // A refused pattern would otherwise look like "no results".
    if (
      fuzzyText &&
      this.plugin.settings.filterUseRegex &&
      compileQueryRegex(this.plugin, fuzzyText) === null
    ) {
      extra.push({ type: "notice", message: strings().regexRejected });
    }

    const fileResults: FileResult[] = [];

    // When the query needs file bodies (content operators), the file list
    // is produced by the async content phase to avoid false positives.
    if (!this.liveHasContent) {
      // Candidate ⑥: remember which files passed the metadata pre-filter
      // so the (later, batched) heading phase can reuse it instead of
      // re-evaluating matchMetadata per file.
      this.passedMeta = new Set<string>();
      for (const file of files) {
        // Active chips (presets) always apply
        if (!this.matchesFilters(file)) continue;
        // Live metadata clauses (tag/path/folder/name/property) apply
        if (!this.searchFilter.matchMetadata(file, query)) continue;
        this.passedMeta.add(file.path);
        const nameMatch = fuzzy ? fuzzy(file.basename) : null;
        const pathMatch = fuzzy ? fuzzy(file.path) : null;
        // Text requirement only applies when there is plain text
        if (fuzzy && !nameMatch && !pathMatch) continue;
        fileResults.push({
          file,
          nameMatch,
          pathMatch,
          type: "file",
        });
      }
    }

    fileResults.sort((a, b) => {
      const sa = Math.max(
        a.nameMatch?.score ?? -Infinity,
        (a.pathMatch?.score ?? -Infinity) * 0.5,
      );
      const sb = Math.max(
        b.nameMatch?.score ?? -Infinity,
        (b.pathMatch?.score ?? -Infinity) * 0.5,
      );
      return sb - sa || a.file.basename.localeCompare(b.file.basename);
    });

    // Check if there is an exact name match (for quick-create gating)
    const queryLower = trimmed.toLowerCase();
    const hasExactMatch = fileResults.some(
      (r) => r.file.basename.toLowerCase() === queryLower,
    );

    const resultsToShow: CmdkResult[] = fileResults
      .filter((r) => this.matchesFilters(r.file))
      .slice(0, this.limit);

    // Append "quick create" option when enabled and no exact match
    if (
      this.plugin.settings.cmdkQuickCreate &&
      !hasExactMatch &&
      pureText &&
      trimmed.length > 0
    ) {
      resultsToShow.push({ type: "create", createQuery: trimmed });
    }

    // Render file results immediately
    chooser.setSuggestions([...extra, ...resultsToShow]);

    // Phase 2: heading search — progressive, batched via setTimeout.
    // Headings can't be checked against content operators, so skip this
    // phase when the query needs file bodies.
    if (trimmed.length >= 2) {
      if (fuzzy && !this.liveHasContent)
        this.progressiveHeadingSearch(files, fuzzy, chooser, signal);

      // Phase 3: content search — progressive, async (reads file content)
      this.progressiveContentSearch(files, query, chooser, signal);
    }
  }

  private progressiveHeadingSearch(
    files: TFile[],
    fuzzy: (text: string) => SearchResult | null,
    chooser: SuggestChooser<CmdkResult>,
    signal: AbortSignal,
  ) {
    const BATCH_SIZE = 50; // files per tick
    let idx = 0;
    let added = 0;
    const MAX_HEADING_RESULTS = 20;

    const processBatch = () => {
      if (signal.aborted || this.closed) return;

      const end = Math.min(idx + BATCH_SIZE, files.length);
      for (; idx < end; idx++) {
        if (added >= MAX_HEADING_RESULTS) return;
        const file = files[idx];
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache?.headings) continue;

        for (const h of cache.headings) {
          const headingMatch = fuzzy(h.heading);
          if (
            headingMatch &&
            this.matchesFilters(file) &&
            // Candidate ⑥: reuse the precomputed pass-set instead of
            // re-running matchMetadata on every heading check.
            (this.passedMeta?.has(file.path) ??
              this.searchFilter.matchMetadata(file, this.liveQuery))
          ) {
            chooser.addSuggestion({
              file,
              nameMatch: null,
              pathMatch: null,
              heading: h.heading,
              headingMatch,
              type: "heading",
            });
            added++;
            if (added >= MAX_HEADING_RESULTS) return;
          }
        }
      }

      // More files to process — yield to event loop
      if (idx < files.length && added < MAX_HEADING_RESULTS) {
        window.setTimeout(() => void processBatch(), 0);
      }
    };

    // Start first batch on next microtask so file results render first
    window.setTimeout(() => void processBatch(), 0);
  }

  private progressiveContentSearch(
    files: TFile[],
    query: Query,
    chooser: SuggestChooser<CmdkResult>,
    signal: AbortSignal,
  ) {
    const BATCH_SIZE = 50;
    const MAX_CONTENT_RESULTS = 20;
    const DURATION_LIMIT = 5; // ms before yielding

    const contentMode = this.liveHasContent;
    // Fuzzy-text mode: a plain free-text search across file bodies.
    const fuzzyText = contentMode ? "" : freeText(query);
    const simpleSearch =
      !contentMode && fuzzyText
        ? createTextMatcher(this.plugin, fuzzyText, "content")
        : null;
    if (!contentMode && !simpleSearch) return;
    if (contentMode && query.groups.length === 0) return;

    let idx = 0;
    let added = 0;

    const processBatch = async () => {
      if (signal.aborted) return;
      const start = performance.now();

      for (; idx < files.length; idx++) {
        if (signal.aborted || added >= MAX_CONTENT_RESULTS) return;

        // Adaptive yielding: check time every BATCH_SIZE items
        if (idx % BATCH_SIZE === 0 && idx > 0) {
          if (performance.now() - start > DURATION_LIMIT) {
            window.setTimeout(() => void processBatch(), 0);
            return;
          }
        }

        const file = files[idx];
        if (file.extension !== "md") continue;

        // Fast metadata pre-filter (no file read needed).
        if (!this.searchFilter.matchMetadata(file, query)) continue;
        if (!contentMode && !this.matchesFilters(file)) continue;

        let text: string;
        try {
          text = await this.app.vault.cachedRead(file);
        } catch {
          continue;
        }

        if (signal.aborted || this.closed) return;
        if (contentMode) {
          // Full query evaluation including content operators.
          if (!this.searchFilter.matchContent(file, text, query)) continue;
          const lineInfo = firstMatchLine(text, query);
          chooser.addSuggestion({
            file,
            nameMatch: null,
            pathMatch: null,
            content: lineInfo.text,
            contentMatch: null,
            line: lineInfo.line,
            type: "content",
          });
          added++;
          if (added >= MAX_CONTENT_RESULTS) return;
          continue;
        }

        const result = simpleSearch!(text);
        if (!result) continue;

        // Compute line number and context from first match offset
        const matchStart = result.matches[0][0];
        let line = 0;
        let lineStart = 0;
        for (let i = 0; i < matchStart; i++) {
          if (text.charCodeAt(i) === 10) {
            line++;
            lineStart = i + 1;
          }
        }
        let lineEnd = text.indexOf("\n", lineStart);
        if (lineEnd === -1) lineEnd = text.length;
        const lineText = text.substring(lineStart, lineEnd).trim();

        // Recompute match on the line for highlight offsets
        const lineMatch = simpleSearch!(lineText);

        chooser.addSuggestion({
          file,
          nameMatch: null,
          pathMatch: null,
          content: lineText,
          contentMatch: lineMatch,
          line,
          type: "content",
        });
        added++;
        if (added >= MAX_CONTENT_RESULTS) return;
      }
    };

    // Start after heading search has a chance to render
    window.setTimeout(() => void processBatch(), contentMode ? 0 : 50);
  }

  renderSuggestion(result: CmdkResult, el: HTMLElement) {
    el.addClass("mod-complex");

    if (result.type === "create") {
      el.addClass("pane-search-cmdk-create-item");
      const contentEl = el.createDiv("suggestion-content");
      const titleEl = contentEl.createDiv("suggestion-title");
      titleEl.setText(strings().cmdkCreateNote);
      const noteEl = contentEl.createDiv("suggestion-note");
      const folder = this.plugin.settings.cmdkQuickCreateFolder || "/";
      noteEl.setText(`"${result.createQuery}" → ${folder}`);
      const auxEl = el.createDiv("suggestion-aux");
      const flair = auxEl.createSpan("suggestion-flair");
      setIcon(flair, "plus");
      return;
    }

    if (result.type === "notice") {
      el.addClass("pane-search-cmdk-notice");
      el.createDiv("suggestion-content")
        .createDiv("suggestion-title")
        .setText(result.message);
      return;
    }

    if (result.type === "save") {
      const contentEl = el.createDiv("suggestion-content");
      const titleEl = contentEl.createDiv("suggestion-title");
      titleEl.setText(strings().saveCurrentTitle);
      const noteEl = contentEl.createDiv("suggestion-note");
      noteEl.setText(this.inputEl.value.trim());
      const auxEl = el.createDiv("suggestion-aux");
      const flair = auxEl.createSpan("suggestion-flair");
      setIcon(flair, "bookmark");
      return;
    }

    const contentEl = el.createDiv("suggestion-content");

    if (result.type === "content" && result.content) {
      const titleEl = contentEl.createDiv("suggestion-title");
      if (result.contentMatch) {
        renderResults(titleEl, result.content, result.contentMatch);
      } else {
        titleEl.setText(result.content);
      }
      const noteEl = contentEl.createDiv("suggestion-note");
      noteEl.setText(result.file.path);
    } else if (result.type === "heading" && result.heading) {
      const titleEl = contentEl.createDiv("suggestion-title");
      if (result.headingMatch) {
        renderResults(titleEl, result.heading, result.headingMatch);
      } else {
        titleEl.setText(result.heading);
      }
      const noteEl = contentEl.createDiv("suggestion-note");
      noteEl.setText(result.file.path);
    } else {
      const titleEl = contentEl.createDiv("suggestion-title");
      if (result.nameMatch) {
        renderResults(titleEl, result.file.basename, result.nameMatch);
      } else {
        titleEl.setText(result.file.basename);
      }

      const noteEl = contentEl.createDiv("suggestion-note");
      const parentPath = result.file.parent?.path || "/";
      if (result.pathMatch) {
        renderResults(noteEl, parentPath, result.pathMatch);
      } else {
        noteEl.setText(parentPath);
      }
    }

    if (result.file.extension !== "md") {
      el.createDiv("suggestion-aux")
        .createSpan("suggestion-flair")
        .setText(result.file.extension);
    }
  }

  onChooseSuggestion(result: CmdkResult, evt: MouseEvent | KeyboardEvent) {
    void this.choose(result, evt);
  }

  private async choose(result: CmdkResult, evt: MouseEvent | KeyboardEvent) {
    if (result.type === "create") {
      void this.quickCreateNote(result.createQuery, evt);
      return;
    }

    if (result.type === "notice") return;

    if (result.type === "save") {
      const current = this.inputEl.value.trim();
      const name = await promptForName(this.app, current);
      if (name) {
        await this.plugin.addSavedSearch(name, current);
      }
      this.close();
      return;
    }

    const leaf = Keymap.isModEvent(evt)
      ? this.app.workspace.getLeaf("tab")
      : (this.app.workspace.getMostRecentLeaf() ??
        this.app.workspace.getLeaf());

    const eState = ephemeralStateFor(result);
    await leaf.openFile(result.file, { active: true });
    if (eState) leaf.setEphemeralState(eState);
  }

  private async quickCreateNote(
    content: string,
    evt: MouseEvent | KeyboardEvent,
  ) {
    const settings = this.plugin.settings;
    const title = safeFileName(
      formatNow(settings.cmdkQuickCreateTitleFormat || "YYYYMMDDHHmmss"),
      strings().untitled,
    );
    const folder = normalizePath(settings.cmdkQuickCreateFolder);
    if (folder && !this.app.vault.getFolderByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }
    const path = uniqueNotePath(
      folder,
      title,
      (candidate) => this.app.vault.getAbstractFileByPath(candidate) !== null,
    );
    const file = await this.app.vault.create(path, content);

    const leaf = Keymap.isModEvent(evt)
      ? this.app.workspace.getLeaf("tab")
      : (this.app.workspace.getMostRecentLeaf() ??
        this.app.workspace.getLeaf());
    await leaf.openFile(file, { active: true });
  }

  // Called by internal Chooser on selection change
  onSelectedChange = debounce((result: CmdkResult, _evt: Event | null) => {
    if (
      result &&
      isFileResult(result) &&
      this.plugin.settings.cmdkAutoPreview
    ) {
      void this.showPreview(result);
    } else {
      this.hidePreview();
    }
  }, 100);

  private selectedResult(): CmdkResult | undefined {
    const { values, selectedItem } = this.chooser;
    return values?.[selectedItem];
  }

  private hidePreview() {
    this.previews.invalidate();
    this.modalEl.removeClass("pane-search-cmdk-expanded");
    if (this.previewEl) {
      this.previewEl.hide();
    }
  }

  async showPreview(result: FileResult) {
    if (this.closed) return;
    this.previewEl?.hide();
    await this.previews.run(async (isCurrent) => {
      if (this.closed) return;
      await this.renderPreview(result, isCurrent);
    });
  }

  private async renderPreview(result: FileResult, isCurrent: () => boolean) {
    if (!this.previewEl) {
      this.previewEl = this.bodyEl.createDiv("pane-search-cmdk-preview");
      const [leaf, view] = spawnLeafView(this.plugin, this.previewEl);
      this.fileLeaf = leaf;
      this.fileEmbeddedView = view;
      this.fileLeaf.setPinned(true);
    }

    this.previewEl.hide();

    const file = result.file;
    const leaf = this.fileLeaf!;
    await leaf.openFile(file, { active: false });
    if (this.closed || !isCurrent()) return;
    this.previewEl.show();
    this.modalEl.addClass("pane-search-cmdk-expanded");

    const eState = ephemeralStateFor(result);
    if (eState) leaf.setEphemeralState(eState);

    this.inputEl.focus();
  }

  onClose() {
    this.closed = true;
    this.searchAbort?.abort();
    this.searchAbort = null;
    this.onSelectedChange.cancel();
    this.hidePreview();
    super.onClose?.();
    for (const ref of this.vaultRefs) this.app.vault.offref(ref);
    this.vaultRefs = [];
    this.fileLeaf?.detach();
    this.fileEmbeddedView?.unload();
    this.fileLeaf = undefined;
    this.fileEmbeddedView = undefined;
    this.previewEl?.remove();
    this.previewEl = undefined;
    this.inputEl.removeEventListener("compositionstart", this.compositionStart);
    this.inputEl.removeEventListener("compositionend", this.compositionEnd);
  }
}
