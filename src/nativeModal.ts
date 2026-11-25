import {
  debounce,
  Keymap,
  Modal,
  Notice,
  Platform,
  type SearchResultItem,
  type SearchView,
  TFile,
  type WorkspaceLeaf,
} from "obsidian";
import { strings } from "./i18n";
import { LatestQueue } from "./latestQueue";
import { type EmbeddedView, spawnLeafView } from "./leafView";
import type SearchOpenPlugin from "./main";
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
  state: SearchState;
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

  searchLeaf: WorkspaceLeaf;
  fileLeaf: WorkspaceLeaf | undefined;

  private cb: (closing?: ClosingState) => void;
  private state: SearchState;
  private readonly caret: Caret | undefined;

  private fileState: PreviewState | undefined;
  private readonly previewedPaths = new Set<string>();
  private stateApplied = false;

  private searchCtnEl: HTMLElement;
  private fileEl: HTMLElement;

  private closed = false;
  private readonly previews = new LatestQueue();
  private inputCleanup: (() => void) | null = null;

  private debouncedAutoPreview = debounce(() => {
    this.autoPreviewFocusedItem();
  }, 150);

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
    new Notice(strings().errorGeneric);
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
    this.initCss(contentEl, modalEl, containerEl);
    await this.initSearchView(this.searchCtnEl);
    if (this.closed) {
      this.searchLeaf?.detach();
      return;
    }
    this.initInput();
    this.initContent();
  }

  onClose() {
    this.closed = true;
    this.debouncedAutoPreview.cancel();
    this.inputCleanup?.();
    this.inputCleanup = null;
    this.clearPreview();
    const { contentEl } = this;

    this.cb(this.stateApplied ? this.closingState() : undefined);

    this.searchLeaf?.detach();
    this.fileLeaf?.detach();
    this.searchEmbeddedView?.unload();
    this.fileEmbeddedView?.unload();
    contentEl.empty();
  }

  private initInstructions(instructionsEl: HTMLElement) {
    if (!this.plugin.settings.showInstructions) return;
    const s = strings();
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

  initCss(
    contentEl: HTMLElement,
    modalEl: HTMLElement,
    containerEl: HTMLElement,
  ) {
    contentEl.classList.add("search-open-modal-content");
    modalEl.classList.add("search-open-modal");
    containerEl.classList.add("search-open-modal-container");
  }

  async initSearchView(contentEl: HTMLElement) {
    const [createdLeaf, embeddedView] = spawnLeafView(this.plugin, contentEl);
    this.searchLeaf = createdLeaf;
    this.searchEmbeddedView = embeddedView;

    this.searchLeaf.setPinned(true);
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
    return (this.searchLeaf.view as SearchView).searchComponent?.inputEl;
  }

  private focusSearchInput() {
    const inputEl = this.searchInput;
    if (inputEl) focusWithoutSuggestions(inputEl);
  }

  initInput(retries = 10) {
    if (this.closed) return;
    const inputEl = this.searchInput;
    if (!inputEl) {
      if (retries > 0) {
        window.setTimeout(() => this.initInput(retries - 1), 50);
      }
      return;
    }
    const clear = () => {
      this.debouncedAutoPreview.cancel();
      this.clearPreview();
    };
    inputEl.addEventListener("input", clear);
    this.inputCleanup = () => {
      inputEl.removeEventListener("input", clear);
      inputEl.onkeydown = null;
    };
    inputEl.focus();
    inputEl.onkeydown = (e) => {
      if (e.isComposing || e.key === "Process") {
        return;
      }
      const currentView = this.searchLeaf.view as SearchView;
      switch (e.key) {
        case "ArrowDown":
        case "n":
          if (e.key === "n" && !e.ctrlKey) break;
          if (e.key === "n") e.preventDefault();

          if (e.shiftKey) {
            currentView.onKeyShowMoreAfter(e);
            if (currentView.dom.focusedItem) {
              if (currentView.dom.focusedItem.collapsible) {
                currentView.dom.focusedItem.setCollapse(false);
              }
            }
          } else {
            currentView.onKeyArrowDownInFocus(e);
            // Obsidian blurs the input here; keep it ready for the next key.
            this.focusSearchInput();
            this.debouncedAutoPreview();
          }
          break;
        case "ArrowUp":
        case "p":
          if (e.key === "p" && !e.ctrlKey) break;
          if (e.key === "p") e.preventDefault();

          if (e.shiftKey) {
            currentView.onKeyShowMoreBefore(e);
            if (currentView.dom.focusedItem) {
              if (currentView.dom.focusedItem.collapseEl) {
                currentView.dom.focusedItem.setCollapse(true);
              }
            }
          } else {
            currentView.onKeyArrowUpInFocus(e);
            this.focusSearchInput();
            this.debouncedAutoPreview();
          }
          break;
        case "ArrowLeft":
          currentView.onKeyArrowLeftInFocus(e);
          break;
        case "ArrowRight":
          currentView.onKeyArrowRightInFocus(e);
          break;
        case "Enter":
          // Obsidian may still count the preview as the active leaf, and the
          // getLeaf patch would then open the result inside the preview.
          this.plugin.app.workspace.setActiveLeaf(this.searchLeaf, {
            focus: false,
          });
          {
            // Opening it for real makes it a recent file after all.
            const item = currentView.dom.focusedItem;
            const file = item?.file ?? item?.parent.file;
            if (file) this.previewedPaths.delete(file.path);
          }
          currentView.onKeyEnterInFocus(e);
          if (currentView.dom.focusedItem && Keymap.isModEvent(e) !== "tab") {
            this.close();
          }
          break;
        case "Tab":
          e.preventDefault();
          if (e.shiftKey && this.fileLeaf) {
            this.clearPreview();
            break;
          }

          {
            const focused = currentView.dom.focusedItem;
            if (focused) this.previewItem(focused);
          }
          break;
        case "e":
          if (e.ctrlKey) {
            e.preventDefault();
            if (this.fileLeaf) {
              const estate = this.fileLeaf.getViewState();
              estate.state = {
                ...estate.state,
                mode: "preview" === estate.state?.mode ? "source" : "preview",
              };
              void this.fileLeaf
                .setViewState(estate, { focus: true })
                .catch((error) => this.reportFailure(error));
              window.setTimeout(() => this.focusSearchInput(), 0);
            }
          }
          break;
        case "g":
          if (this.fileLeaf && e.ctrlKey) {
            e.preventDefault();
            this.plugin.app.workspace.setActiveLeaf(this.fileLeaf, {
              focus: true,
            });
          }
          break;
        case "C":
          if (e.ctrlKey && e.shiftKey) {
            e.preventDefault();
            const text = currentView.dom.focusedItem?.el.innerText;
            if (text) void navigator.clipboard.writeText(text);
          }
          break;
      }
    };
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

  initContent() {
    const { contentEl } = this;
    contentEl.onclick = (e) => {
      const resultElement = contentEl.getElementsByClassName(
        "search-results-children",
      )[0];
      if (!resultElement || resultElement.children.length < 2) {
        return;
      }

      let targetElement = e.target as HTMLElement | null;

      if (e.altKey || !this.fileLeaf) {
        while (targetElement) {
          if (targetElement.classList.contains("tree-item-icon")) {
            break;
          }
          if (targetElement.classList.contains("search-result-hover-button")) {
            break;
          }
          if (targetElement.classList.contains("tree-item")) {
            this.close();
            break;
          }
          targetElement = targetElement.parentElement;
        }
        return;
      }

      if (this.fileLeaf) {
        const currentView = this.searchLeaf.view as SearchView;

        if (this.searchCtnEl.contains(targetElement)) {
          while (targetElement) {
            if (targetElement.classList.contains("tree-item")) {
              break;
            }
            targetElement = targetElement.parentElement;
          }
          if (!targetElement) return;

          for (const [file, item] of currentView.dom.resultDomLookup) {
            if (item.el !== targetElement) continue;
            currentView.dom.setFocusedItem(item);
            void this.initFileView(file, undefined);
            this.focusSearchInput();
            break;
          }
        }

        return;
      }
    };
  }

  private clearPreview() {
    this.previews.invalidate();
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

  async initFileView(file: TFile, state: PreviewState | undefined) {
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

  private async renderFileView(
    file: TFile,
    state: PreviewState | undefined,
    isCurrent: () => boolean,
  ) {
    if (this.fileLeaf) {
      await this.fileLeaf.openFile(file, {
        active: false,
        eState: state,
      });
      if (this.closed || !isCurrent()) return;

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
          this.focusSearchInput();
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
      if (e.ctrlKey && e.key === "g") {
        e.preventDefault();
        e.stopPropagation();

        this.focusSearchInput();
      }

      if (e.key === "Tab" && e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();

        this.focusSearchInput();
      }
    };

    const [createdLeaf, embeddedView] = spawnLeafView(this.plugin, this.fileEl);
    this.fileLeaf = createdLeaf;
    this.fileEmbeddedView = embeddedView;

    this.fileLeaf.setPinned(true);
    await this.fileLeaf.openFile(file, {
      active: false,
      eState: state,
    });
    if (this.closed || !isCurrent()) return;
    this.fileState = state;

    this.focusSearchInput();
  }
}
