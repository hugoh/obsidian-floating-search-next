import {
  debounce,
  Keymap,
  Modal,
  type Modifier,
  Notice,
  Platform,
  type SearchResultItem,
  type SearchView,
  TFile,
  type WorkspaceLeaf,
} from "obsidian";
import { selectMatchedCard } from "./canvasSelection";
import { strings } from "./i18n";
import { LatestQueue } from "./latestQueue";
import { EmbeddedView } from "./leafView";
import type SearchOpenPlugin from "./main";
import { markMatch } from "./matchHighlight";
import type { SearchState } from "./settings";

/**
 * Obsidian opens its search-operator menu whenever the input gains focus.
 * Focus the input with that one handler skipped, so putting focus back does
 * not bring the menu up.
 */
function focusWithoutSuggestions(inputEl: HTMLInputElement) {
  const swallow = (e: Event) => e.stopImmediatePropagation();
  inputEl.addEventListener("focus", swallow, { capture: true });
  inputEl.focus();
  inputEl.removeEventListener("focus", swallow, { capture: true });
}

/** Where the cursor and selection sat in the search box. */
export interface Caret {
  start: number;
  end: number;
}

/** What the modal hands back on close, once the search view took its state. */
export interface ClosingState {
  state: Partial<SearchState>;
  caret: Caret;
}

/** Where the preview should land: the matched text inside a result row. */
export interface PreviewState extends Record<string, unknown> {
  match?: { content?: string; matches?: unknown[] };
}

export class SearchOpenModal extends Modal {
  private readonly plugin: SearchOpenPlugin;
  private searchEmbeddedView: EmbeddedView;
  private fileEmbeddedView: EmbeddedView | undefined;

  private searchLeaf: WorkspaceLeaf;
  private fileLeaf: WorkspaceLeaf | undefined;

  private cb: (closing?: ClosingState) => void;
  private state: SearchState;
  private readonly caret: Caret | undefined;

  private fileState: PreviewState | undefined;
  private stopMarkingMatch = () => {};
  private readonly previewedPaths = new Set<string>();
  private stateApplied = false;

  private searchCtnEl: HTMLElement;
  private fileEl: HTMLElement;

  private closed = false;
  private readonly previews = new LatestQueue();

  private debouncedAutoPreview = debounce(() => {
    this.autoPreviewFocusedItem();
  }, 150);

  /** Typing invalidates whatever preview is showing or pending. */
  private readonly clearPreviewOnInput = () => {
    this.debouncedAutoPreview.cancel();
    const hadPreview = Boolean(this.fileLeaf);
    this.clearPreview();
    // Detaching the preview leaf makes Obsidian drop focus to the page, which
    // would swallow the rest of what the user is typing.
    if (hadPreview) {
      window.setTimeout(() => {
        if (!this.closed) this.focusSearchInput();
      }, 0);
    }
  };

  constructor(
    cb: (closing?: ClosingState) => void,
    plugin: SearchOpenPlugin,
    state: SearchState,
    caret?: Caret,
  ) {
    super(plugin.app);
    this.plugin = plugin;
    this.cb = cb;
    this.state = state;
    this.caret = caret;
  }

  async onOpen() {
    try {
      await this.build();
    } catch (error) {
      this.reportFailure(error);
      this.close();
    }
  }

  private closingState(): ClosingState {
    const saved = this.searchLeaf.view.getState();
    const inputEl = this.searchInput;
    return {
      state: {
        ...saved,
        query: typeof saved.query === "string" ? saved.query : "",
      },
      caret: {
        start: inputEl?.selectionStart ?? 0,
        end: inputEl?.selectionEnd ?? 0,
      },
    };
  }

  /** Tells the user something went wrong; the details go to the console. */
  private reportFailure(error: unknown) {
    console.error("Search & Open:", error);
    new Notice(strings.errorGeneric);
  }

  private async build() {
    this.closed = false;
    const { contentEl, containerEl, modalEl } = this;

    this.searchCtnEl = contentEl.createDiv({
      cls: "search-open-modal-search-ctn",
    });
    this.initInstructions(
      modalEl.createDiv({ cls: "search-open-modal-instructions" }),
    );
    contentEl.classList.add("search-open-modal-content");
    modalEl.classList.add("search-open-modal");
    containerEl.classList.add("search-open-modal-container");
    await this.initSearchView(this.searchCtnEl);
    if (this.closed) {
      this.searchLeaf?.detach();
      return;
    }
    this.initInput();
    this.initContent();
    this.closeOnResultDrag();
  }

  /**
   * Dragging a result into the workspace leaves the modal in the way. It closes
   * once the drag has started: removing the drag source sooner cancels it.
   */
  private closeOnResultDrag() {
    this.searchCtnEl.addEventListener("dragstart", (e) => {
      const target = e.target as Element | null;
      if (!target?.closest(".tree-item")) return;
      window.setTimeout(() => this.close(), 10);
    });
  }

  onClose() {
    this.closed = true;
    this.debouncedAutoPreview.cancel();
    const inputEl = this.searchInput;
    inputEl?.removeEventListener("input", this.clearPreviewOnInput);
    this.clearPreview();
    const { contentEl } = this;

    const closing = this.stateApplied ? this.closingState() : undefined;

    this.searchLeaf?.detach();
    this.fileLeaf?.detach();
    this.searchEmbeddedView?.unload();
    this.fileEmbeddedView?.unload();
    contentEl.empty();

    // Last, because the callback removes the patches the detaching relies on.
    this.cb(closing);
  }

  private initInstructions(instructionsEl: HTMLElement) {
    if (!this.plugin.settings.showInstructions) return;
    const s = strings;
    const hints: [key: string, text: string][] = [
      ["↑↓", s.instrNavigate],
      ["Shift+↑↓", s.instrCollapse],
      ["↵", s.instrOpenAndClose],
      [Platform.isMacOS ? "⌘↵" : "Ctrl+↵", s.instrOpenNewTab],
      ["Tab/Shift+Tab", s.instrPreview],
      ["Ctrl+G", s.instrSwitchView],
      ["Alt+Click", s.instrAltClick],
    ];
    for (const [key, text] of hints) {
      const hint = instructionsEl.createDiv();
      hint.createSpan({ cls: "search-open-modal-instructions-key", text: key });
      hint.createSpan({ cls: "search-open-modal-instructions-text", text });
    }
  }

  private async initSearchView(contentEl: HTMLElement) {
    this.searchEmbeddedView = new EmbeddedView(contentEl, this.plugin);
    this.searchLeaf = this.searchEmbeddedView.leaf;

    const initialQuery = this.state.query ?? "";
    const initialState = { ...this.state, query: initialQuery };
    await this.searchLeaf.setViewState({
      type: "search",
      state: initialState,
    });
    this.stateApplied = true;

    window.setTimeout(
      () =>
        void this.settleInitialState(initialState, initialQuery).catch(
          (error) => this.reportFailure(error),
        ),
      0,
    );
  }

  /**
   * The view re-applies the saved state once it has settled, but never over
   * text the user already typed. The query is then selected, or, when
   * reopening with the last state, the cursor goes back where it was.
   */
  private async settleInitialState(
    initialState: SearchState,
    initialQuery: string,
  ) {
    if (this.closed) return;
    const view = this.searchLeaf.view as SearchView;
    const typed = this.searchInput?.value;
    // Text the user typed meanwhile owns the input, and the caret with it.
    if (typed && typed !== initialQuery) return;
    await view.setState(initialState, { history: false });
    if (this.closed) return;
    const inputEl = this.searchInput;
    if (!inputEl) return;
    if (this.caret) {
      inputEl.blur();
      focusWithoutSuggestions(inputEl);
      const length = inputEl.value.length;
      inputEl.setSelectionRange(
        Math.min(this.caret.start, length),
        Math.min(this.caret.end, length),
      );
    } else {
      inputEl.setSelectionRange(0, this.state.query?.length ?? 0);
    }
  }

  private get searchInput(): HTMLInputElement | undefined {
    const view = this.searchLeaf?.view as SearchView | undefined;
    return view?.searchComponent?.inputEl;
  }

  private focusSearchInput() {
    const inputEl = this.searchInput;
    if (inputEl) focusWithoutSuggestions(inputEl);
  }

  /** Opening a preview takes focus; hand it back unless the user has gone into the preview. */
  private refocusSearchInput() {
    if (this.fileEl?.matches(":focus-within")) return;
    this.focusSearchInput();
  }

  private initInput(retries = 10) {
    if (this.closed) return;
    const inputEl = this.searchInput;
    if (!inputEl) {
      if (retries > 0) {
        window.setTimeout(() => this.initInput(retries - 1), 50);
      }
      return;
    }
    inputEl.addEventListener("input", this.clearPreviewOnInput);
    inputEl.focus();
    this.registerKeys();
  }

  /**
   * Keys in the search box drive the embedded search view, which is not the
   * active leaf and so never sees them itself. Each handler passes on events
   * from anywhere else, such as the preview, and while text is being composed.
   */
  private registerKeys() {
    const on = (
      modifiers: Modifier[] | null,
      key: string,
      handle: (e: KeyboardEvent) => unknown,
    ) => {
      this.scope.register(modifiers, key, (e) => {
        if (e.isComposing || e.target !== this.searchInput) return true;
        return handle(e);
      });
    };
    on(null, "ArrowDown", (e) => this.moveDown(e));
    on(null, "ArrowUp", (e) => this.moveUp(e));
    on(["Ctrl"], "n", (e) => {
      this.moveDown(e);
      return false;
    });
    on(["Ctrl"], "p", (e) => {
      this.moveUp(e);
      return false;
    });
    on(null, "Enter", (e) => this.openFocused(e));
    on(null, "Tab", (e) => {
      if (e.shiftKey && this.fileLeaf) {
        this.clearPreview();
        return false;
      }
      const focused = this.searchView.dom.focusedItem;
      if (focused) this.previewItem(focused);
      return false;
    });
    on(["Ctrl"], "g", () => {
      if (!this.fileLeaf) return true;
      this.plugin.app.workspace.setActiveLeaf(this.fileLeaf, { focus: true });
      return false;
    });
  }

  private get searchView() {
    return this.searchLeaf.view as SearchView;
  }

  private moveDown(e: KeyboardEvent) {
    const view = this.searchView;
    if (e.shiftKey) {
      view.onKeyShowMoreAfter(e);
      const focused = view.dom.focusedItem;
      if (focused?.collapsible) focused.setCollapse(false);
      return;
    }
    view.onKeyArrowDownInFocus(e);
    // Obsidian blurs the input here; keep it ready for the next key.
    this.focusSearchInput();
    this.debouncedAutoPreview();
  }

  private moveUp(e: KeyboardEvent) {
    const view = this.searchView;
    if (e.shiftKey) {
      view.onKeyShowMoreBefore(e);
      const focused = view.dom.focusedItem;
      if (focused?.collapseEl) focused.setCollapse(true);
      return;
    }
    view.onKeyArrowUpInFocus(e);
    this.focusSearchInput();
    this.debouncedAutoPreview();
  }

  private openFocused(e: KeyboardEvent) {
    const view = this.searchView;
    // Obsidian may still count the preview as the active leaf, and the
    // getLeaf patch would then open the result inside the preview.
    this.plugin.app.workspace.setActiveLeaf(this.searchLeaf, { focus: false });
    // Opening it for real makes it a recent file after all.
    const item = view.dom.focusedItem;
    const file = item?.file ?? item?.parent.file;
    if (file) this.previewedPaths.delete(file.path);
    view.onKeyEnterInFocus(e);
    if (view.dom.focusedItem && Keymap.isModEvent(e) !== "tab") this.close();
  }

  private autoPreviewFocusedItem() {
    if (this.closed) return;
    const currentView = this.searchLeaf.view as SearchView;
    const item = currentView.dom?.focusedItem;
    if (!item) {
      this.clearPreview();
      return;
    }

    this.previewItem(item);
  }

  /** Preview the file behind a result row, jumping to the match for match rows. */
  private previewItem(item: SearchResultItem) {
    const matchFile = item.parent?.file;
    const file = matchFile instanceof TFile ? matchFile : item.file;
    if (!(file instanceof TFile)) return;
    const state =
      matchFile instanceof TFile
        ? { match: { content: item.content, matches: item.matches } }
        : undefined;
    void this.initFileView(file, state);
  }

  private initContent() {
    const { contentEl } = this;
    contentEl.onclick = (e) => {
      const resultElement = contentEl.getElementsByClassName(
        "search-results-children",
      )[0];
      if (!resultElement || resultElement.children.length < 2) return;

      const target = e.target as HTMLElement | null;

      // Without a preview, or with Alt held, clicking a result opens it.
      if (e.altKey || !this.fileLeaf) {
        const hit = target?.closest(
          ".tree-item-icon, .search-result-hover-button, .tree-item",
        );
        if (hit?.matches(".tree-item-icon, .search-result-hover-button")) {
          return;
        }
        if (hit) this.close();
        return;
      }

      // Otherwise it previews the clicked result.
      if (!target || !this.searchCtnEl.contains(target)) return;
      const row = target.closest(".tree-item");
      if (!row) return;
      const view = this.searchLeaf.view as SearchView;
      for (const [file, item] of view.dom.resultDomLookup) {
        if (item.el !== row) continue;
        view.dom.setFocusedItem(item);
        void this.initFileView(file, undefined);
        this.focusSearchInput();
        break;
      }
    };
  }

  private clearPreview() {
    this.previews.invalidate();
    this.stopMarkingMatch();
    this.fileState = undefined;
    this.fileLeaf?.detach();
    this.fileEmbeddedView?.unload();
    this.fileLeaf = undefined;
    this.fileEmbeddedView = undefined;
    this.fileEl?.remove();
    this.contentEl.removeClass("has-file-ctn");
    this.modalEl.removeClass("search-open-width");
  }

  /** Whether this file was shown in the preview and not opened since. */
  hasPreviewed(file: TFile) {
    return this.previewedPaths.has(file.path);
  }

  private async initFileView(file: TFile, state: PreviewState | undefined) {
    if (this.closed) return;
    this.previewedPaths.add(file.path);
    try {
      await this.previews.run(async (isCurrent) => {
        if (this.closed) return;
        await this.renderFileView(file, state, isCurrent);
      });
    } catch (error) {
      this.reportFailure(error);
      if (!this.closed) this.clearPreview();
    }
  }

  /** The preview is only ever shown in reading mode, never as an editor. */
  private async openReadOnly(
    leaf: WorkspaceLeaf,
    file: TFile,
    state: PreviewState | undefined,
  ) {
    await leaf.openFile(file, {
      active: false,
      state: { mode: "preview" },
      eState: state,
    });
    selectMatchedCard(leaf, file, state?.match?.content);
  }

  private markPreviewMatch(state: PreviewState | undefined) {
    this.stopMarkingMatch();
    this.stopMarkingMatch = markMatch(
      this.fileLeaf?.view.containerEl,
      state?.match,
    );
  }

  private async renderFileView(
    file: TFile,
    state: PreviewState | undefined,
    isCurrent: () => boolean,
  ) {
    if (this.fileLeaf) {
      await this.openReadOnly(this.fileLeaf, file, state);
      if (this.closed || !isCurrent()) return;
      this.markPreviewMatch(state);

      if (
        this.fileState?.match?.matches?.[0] === state?.match?.matches?.[0] &&
        state &&
        this.fileState
      ) {
        window.setTimeout(() => {
          if (!this.closed && isCurrent() && this.fileLeaf) {
            this.plugin.app.workspace.setActiveLeaf(this.fileLeaf, {
              focus: true,
            });
          }
        }, 0);
      } else {
        this.fileState = state;
        window.setTimeout(() => {
          if (this.closed || !isCurrent()) return;
          this.refocusSearchInput();
        }, 0);
      }

      return;
    }

    const { contentEl } = this;
    this.fileEl = contentEl.createDiv({
      cls: "search-open-modal-file-ctn",
    });
    contentEl.addClass("has-file-ctn");
    this.modalEl.toggleClass("search-open-width", true);
    this.fileEl.onkeydown = (e) => {
      if (e.ctrlKey && (e.key === "g" || e.key === "Tab")) {
        e.preventDefault();
        e.stopPropagation();

        this.focusSearchInput();
      }
    };

    this.fileEmbeddedView = new EmbeddedView(this.fileEl, this.plugin);
    this.fileLeaf = this.fileEmbeddedView.leaf;

    await this.openReadOnly(this.fileLeaf, file, state);
    if (this.closed || !isCurrent()) return;
    this.markPreviewMatch(state);
    this.fileState = state;

    this.refocusSearchInput();
  }
}
