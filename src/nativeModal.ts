import {
  debounce,
  Modal,
  type SearchResultItem,
  type SearchView,
  TFile,
  type WorkspaceLeaf,
} from "obsidian";
import { strings } from "./i18n";
import { LatestQueue } from "./latestQueue";
import { type EmbeddedView, spawnLeafView } from "./leafView";
import type PaneSearchPlugin from "./paneSearchIndex";
import type { SearchState } from "./settings";

function createInstructionElement(
  parentEl: HTMLElement,
  divCls: string,
  keyText: string,
  text: string,
) {
  const divEl = parentEl.createDiv({ cls: divCls });
  const iconEl = divEl.createSpan({
    cls: "pane-search-modal-instructions-key",
  });
  const textEl = divEl.createSpan({
    cls: "pane-search-modal-instructions-text",
  });

  iconEl.setText(keyText);
  textEl.setText(text);

  return { divEl, iconEl, textEl };
}

/** Where the preview should land: the matched text inside a result row. */
export interface PreviewState extends Record<string, unknown> {
  match?: { content?: string; matches?: unknown[] };
}

export class PaneSearchModal extends Modal {
  private readonly plugin: PaneSearchPlugin;
  private searchEmbeddedView: EmbeddedView;
  private fileEmbeddedView: EmbeddedView | undefined;

  searchLeaf: WorkspaceLeaf;
  fileLeaf: WorkspaceLeaf | undefined;

  private cb: (state: SearchState) => void;
  private state: SearchState;

  private fileState: PreviewState | undefined;

  private searchCtnEl: HTMLElement;
  private instructionsEl: HTMLElement;
  private fileEl: HTMLElement;
  private viewType: string;

  private focusdItem: SearchResultItem | undefined;
  private closed = false;
  private readonly previews = new LatestQueue();
  private inputCleanup: (() => void) | null = null;

  private debouncedAutoPreview = debounce(() => {
    this.autoPreviewFocusedItem();
  }, 150);

  constructor(
    cb: (state: SearchState) => void,
    plugin: PaneSearchPlugin,
    state: SearchState,
    viewType = "search",
  ) {
    super(plugin.app);
    this.plugin = plugin;
    this.cb = cb;
    this.state = state;
    this.viewType = viewType;
  }

  async onOpen() {
    this.closed = false;
    const { contentEl, containerEl, modalEl } = this;

    this.searchCtnEl = contentEl.createDiv({
      cls: "pane-search-modal-search-ctn",
    });
    this.instructionsEl = modalEl.createDiv({
      cls: "pane-search-modal-instructions",
    });

    this.initInstructions(this.instructionsEl);
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

    if (this.searchLeaf) {
      const saved = this.searchLeaf.view.getState();
      this.cb({
        ...saved,
        query: typeof saved.query === "string" ? saved.query : "",
      });
    }

    this.searchLeaf?.detach();
    this.fileLeaf?.detach();
    this.searchEmbeddedView?.unload();
    this.fileEmbeddedView?.unload();
    contentEl.empty();
  }

  initInstructions(instructionsEl: HTMLElement) {
    if (!this.plugin.settings.showInstructions) {
      return;
    }
    const s = strings();
    createInstructionElement(
      instructionsEl,
      "pane-search-modal-instructions-navigate",
      "↑↓",
      s.instrNavigate,
    );
    createInstructionElement(
      instructionsEl,
      "pane-search-modal-instructions-collapse",
      "Shift+↑↓",
      s.instrCollapse,
    );
    createInstructionElement(
      instructionsEl,
      "pane-search-modal-instructions-enter",
      "↵",
      s.instrOpenBackground,
    );
    createInstructionElement(
      instructionsEl,
      "pane-search-modal-instructions-alt-enter",
      "Alt+↵",
      s.instrOpenAndClose,
    );
    createInstructionElement(
      instructionsEl,
      "pane-search-modal-instructions-tab",
      "Tab/Shift+Tab",
      s.instrPreview,
    );
    createInstructionElement(
      instructionsEl,
      "pane-search-modal-instructions-switch",
      "Ctrl+G",
      s.instrSwitchView,
    );
    createInstructionElement(
      instructionsEl,
      "pane-search-modal-instructions-click",
      "Alt+Click",
      s.instrAltClick,
    );
  }

  initCss(
    contentEl: HTMLElement,
    modalEl: HTMLElement,
    containerEl: HTMLElement,
  ) {
    contentEl.classList.add("pane-search-modal-content");
    modalEl.classList.add("pane-search-modal");
    containerEl.classList.add("pane-search-modal-container");
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

    window.setTimeout(
      () => void this.settleInitialState(initialState, initialQuery),
      0,
    );
  }

  /**
   * The view re-applies the saved state once it has settled, but never over
   * text the user already typed; then the caret goes where the query ends.
   */
  private async settleInitialState(
    initialState: SearchState,
    initialQuery: string,
  ) {
    if (this.closed) return;
    const view = this.searchLeaf.view as SearchView;
    const typed = view.searchComponent?.inputEl?.value;
    if (!typed || typed === initialQuery) {
      await view.setState(initialState, { history: false });
    }
    if (this.closed) return;
    const inputEl = view.searchComponent?.inputEl;
    if (inputEl) {
      if (this.state.current) inputEl.setSelectionRange(0, 0);
      else inputEl.setSelectionRange(0, this.state.query?.length ?? 0);
    }
  }

  initInput(retries = 10) {
    if (this.closed) return;
    const inputEl = this.contentEl.getElementsByTagName("input")[0];
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
              this.focusdItem = currentView.dom.focusedItem ?? undefined;
            }
          } else {
            currentView.onKeyArrowDownInFocus(e);
            this.focusdItem = currentView.dom.focusedItem ?? undefined;
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
              this.focusdItem = currentView.dom.focusedItem ?? undefined;
            }
          } else {
            currentView.onKeyArrowUpInFocus(e);
            this.focusdItem = currentView.dom.focusedItem ?? undefined;
            if (!currentView.dom.focusedItem?.content) {
              this.focusdItem = undefined;
            }
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
          currentView.onKeyEnterInFocus(e);
          if (e.altKey && currentView.dom.focusedItem) {
            this.close();
          }
          break;
        case "Tab":
          e.preventDefault();
          if (e.shiftKey) {
            if (this.fileLeaf) {
              this.fileLeaf?.detach();
              this.fileLeaf = undefined;
              this.fileEmbeddedView?.unload();
              this.modalEl.toggleClass("pane-search-width", false);
              this.fileEl.detach();

              break;
            }
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
              void this.fileLeaf.setViewState(estate, {
                focus: true,
              });
              window.setTimeout(() => {
                (
                  this.searchLeaf.view as SearchView
                ).searchComponent?.inputEl?.focus();
              }, 0);
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

          const fileInnerEl = targetElement?.getElementsByClassName(
            "tree-item-inner",
          )[0] as HTMLElement;
          const innerText = fileInnerEl.innerText;
          const file = this.plugin.app.metadataCache.getFirstLinkpathDest(
            innerText,
            "",
          );

          if (file) {
            const item = currentView.dom.resultDomLookup.get(file);
            currentView.dom.setFocusedItem(item);
            void this.initFileView(file, undefined);
            (
              this.searchLeaf.view as SearchView
            ).searchComponent?.inputEl?.focus();
          }
        }

        return;
      }
    };
  }

  private clearPreview() {
    this.previews.invalidate();
    this.focusdItem = undefined;
    this.fileState = undefined;
    this.fileLeaf?.detach();
    this.fileEmbeddedView?.unload();
    this.fileLeaf = undefined;
    this.fileEmbeddedView = undefined;
    this.fileEl?.remove();
    this.modalEl.removeClass("pane-search-width");
  }

  async initFileView(file: TFile, state: PreviewState | undefined) {
    if (this.closed) return;
    await this.previews.run(async (isCurrent) => {
      if (this.closed) return;
      await this.renderFileView(file, state, isCurrent);
    });
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
          (
            this.searchLeaf.view as SearchView
          ).searchComponent?.inputEl?.focus();
        }, 0);
      }

      return;
    }

    const { contentEl } = this;
    this.fileEl = contentEl.createDiv({
      cls: "pane-search-modal-file-ctn",
    });
    contentEl.addClass("has-file-ctn");
    this.modalEl.toggleClass("pane-search-width", true);
    this.fileEl.onkeydown = (e) => {
      if (e.ctrlKey && e.key === "g") {
        e.preventDefault();
        e.stopPropagation();

        (this.searchLeaf.view as SearchView).searchComponent?.inputEl?.focus();
      }

      if (e.key === "Tab" && e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();

        (this.searchLeaf.view as SearchView).searchComponent?.inputEl?.focus();
      }
    };

    if (!this.fileEl) return;

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

    (this.searchLeaf.view as SearchView).searchComponent?.inputEl?.focus();
  }
}
