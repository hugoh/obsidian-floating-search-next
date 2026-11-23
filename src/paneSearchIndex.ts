import { around } from "monkey-around";
import {
  addIcon,
  type DragManager,
  debounce,
  Editor,
  ExtraButtonComponent,
  Menu,
  type MenuItem,
  type ObsidianProtocolData,
  type OpenViewState,
  type PaneType,
  Plugin,
  requireApiVersion,
  type SearchResultDom,
  type SearchView,
  Setting,
  setIcon,
  type TAbstractFile,
  TFile,
  View,
  Workspace,
  WorkspaceContainer,
  type WorkspaceItem,
  WorkspaceLeaf,
} from "obsidian";
import { PaneSearchCmdkModal } from "./cmdkModal";

import { stripExclusion, withExclusion } from "./exclusions";
import { registerFilterIcons } from "./filterBar";
import { strings } from "./i18n";
import { EmbeddedView, isEmbeddedLeaf } from "./leafView";
import { PaneSearchModal } from "./nativeModal";
import { escapeRegex } from "./regex";
import { SearchFilter } from "./searchFilter";
import {
  DEFAULT_SETTINGS,
  newSavedSearchId,
  type PaneSearchSettings,
  parseViewType,
  type SearchState,
  type SearchType,
  type SortOrder,
  sanitizeSettings,
} from "./settings";
import { PaneSearchSettingTab } from "./settingsTab";

interface viewType {
  type: SearchType;
  icon: string;
}

const allViews: viewType[] = [
  {
    type: "modal",
    icon: "square-equal",
  },
  {
    type: "sidebar",
    icon: "panel-left-inactive",
  },
  {
    type: "split",
    icon: "split-square-horizontal",
  },
  {
    type: "tab",
    icon: "panel-top",
  },
  {
    type: "window",
    icon: "app-window",
  },
];

interface CanvasNode {
  id: string;
  text?: string;
}

/** The slice of a Canvas view used to select the matched card in a preview. */
interface CanvasLeafView {
  canvas?: {
    data: { nodes?: CanvasNode[] };
    nodes: Map<string, CanvasNode>;
    selectOnly(node: CanvasNode): void;
    zoomToSelection(): void;
  };
}

type SearchViewState = Record<string, unknown> & {
  query?: unknown;
  triggerBySelf?: boolean;
};

/** Methods of the native search view that Obsidian does not declare. */
interface SearchViewPrototype {
  onOpen(): unknown;
  setExplainSearch(value: boolean): void;
  setCollapseAll(value: boolean): void;
  setExtraContext(value: boolean): void;
  setMatchingCase(value: boolean): void;
  setSortOrder(value: string): void;

  setState(state: SearchViewState, eState: unknown): unknown;
}

/** The current (leaf, params) form of Workspace.setActiveLeaf. */
interface ActivatableWorkspace {
  setActiveLeaf(leaf: WorkspaceLeaf, params?: { focus?: boolean }): void;
}

/** Editor methods Obsidian's search addon calls but does not declare. */
interface HighlightingEditor {
  removeHighlights?: (...args: unknown[]) => void;
  hasHighlight?: (...args: unknown[]) => boolean;
}

export default class PaneSearchPlugin extends Plugin {
  settings: PaneSearchSettings;
  private state: SearchState;
  private modal: PaneSearchModal;
  private cmdkModal: PaneSearchCmdkModal;

  queryLoaded = false;

  // Guards for the setState re-route, which would otherwise spawn a new Float
  // Search on every external setState and loop forever. `routingQuery` blocks
  // re-entrancy; `lastRouted` ignores the same query repeated within a second.
  routing = false;
  private lastRouted = { query: "", at: 0 };

  /** True while a freshly patched search view rebuilds itself. */
  private suppressViewStatePersist = false;

  isDuplicateRoute(query: string): boolean {
    const now = Date.now();
    const duplicate =
      query === this.lastRouted.query && now - this.lastRouted.at < 1000;
    this.lastRouted = { query, at: now };
    return duplicate;
  }

  persistViewState(patch: Partial<SearchState>) {
    if (!this.app.workspace.layoutReady || this.suppressViewStatePersist)
      return;
    Object.assign(this.settings.searchViewState, patch);
    this.applySettingsUpdate();
  }

  public applySettingsUpdate = debounce(async () => {
    // Ensure all search state properties are preserved
    this.settings.searchViewState = {
      ...DEFAULT_SETTINGS.searchViewState,
      ...this.settings.searchViewState,
      query: "",
    };
    await this.saveSettings();
  }, 1000);

  private applyStateUpdate = debounce(() => {
    // Preserve all state properties when updating
    this.state = {
      ...DEFAULT_SETTINGS.searchViewState,
      ...this.state,
      query: "",
    };
  }, 30000);

  async onload() {
    await this.loadSettings();
    this.initState();

    this.registerIcons();
    registerFilterIcons();
    this.app.workspace.onLayoutReady(() => {
      // The prototype monkeypatches (patchWorkspace / patchSearchView / …)
      // are deferred to first use via ensurePatched() — they are only
      // needed once the user actually opens a pane search, so we no
      // longer pay for them at every startup (candidate ⑤).
      this.registerDoubleKeyHandler();
    });

    this.registerObsidianURIHandler();
    this.registerObsidianCommands();
    this.registerEditorMenuHandler();
    this.registerContextMenuHandler();

    this.addRibbonIcon(
      "pane-search-window",
      strings().ribbonSearch(this.settings.defaultViewType),
      () => void this.openSearch(this.state, undefined, true),
    );
    this.updateFilePathVisibility();
    this.addSettingTab(new PaneSearchSettingTab(this.app, this));
  }

  onunload() {
    // this.state = DEFAULT_SETTINGS.searchViewState;
    // Saving is debounced; do not drop a change made just before unloading.
    void this.applySettingsUpdate.run();
    this.modal?.close();
    this.cmdkModal?.close();
  }

  // Candidate ⑤: run the prototype monkeypatches exactly once, on first use,
  // instead of unconditionally at every startup.
  private patched = false;
  private ensurePatched() {
    if (this.patched) return;
    this.patched = true;
    this.patchWorkspace();
    this.patchWorkspaceLeaf();
    this.patchSearchView();
    this.patchVchildren();
    this.patchDragManager();
    this.patchEditorHighlights();
  }

  // Obsidian's search addon calls removeHighlights()/hasHighlight() on every
  // markdown editor whenever a search runs. Editors created inside the
  // embedded (HoverPopover) preview leaf may not have the search-highlight
  // StateField registered in their CodeMirror state, so `state.field(...)`
  // throws "Field is not present in this state" and crashes the app. Wrap
  // both methods defensively so the embedded preview can never crash Obsidian
  // — when the field is absent there are simply no highlights to manage.
  private patchEditorHighlights() {
    const swallowMissingField =
      <R>(fallback: R) =>
      (original: (...args: unknown[]) => R) =>
        function (this: unknown, ...args: unknown[]): R {
          try {
            return original.apply(this, args);
          } catch (e) {
            if (
              e instanceof RangeError &&
              /Field is not present in this state/.test(e.message)
            ) {
              return fallback;
            }
            throw e;
          }
        };
    const proto = Editor.prototype as unknown as HighlightingEditor;
    this.register(
      around(proto, {
        ...(proto.removeHighlights && {
          removeHighlights: swallowMissingField<void>(undefined),
        }),
        ...(proto.hasHighlight && {
          hasHighlight: swallowMissingField(false),
        }),
      }),
    );
  }

  registerDoubleKeyHandler() {
    let lastKeyUp = 0;
    let keyOnly = true;

    const listen = (doc: Document) => {
      this.registerDomEvent(doc, "keydown", (e: KeyboardEvent) => {
        const triggerKey = this.settings.cmdkTriggerKey;
        if (triggerKey === "none" || e.key !== triggerKey) {
          keyOnly = false;
        }
      });

      this.registerDomEvent(doc, "keyup", (e: KeyboardEvent) => {
        const triggerKey = this.settings.cmdkTriggerKey;
        if (triggerKey === "none" || e.key !== triggerKey) return;
        const now = Date.now();
        if (
          keyOnly &&
          now - lastKeyUp < this.settings.cmdkDoubleTapInterval &&
          !doc.querySelector(".pane-search-cmdk-container")
        ) {
          lastKeyUp = 0;
          this.openCmdkModal();
        } else {
          lastKeyUp = now;
          keyOnly = true;
        }
      });
    };

    listen(activeDocument);
    this.registerEvent(
      this.app.workspace.on("window-open", (_workspaceWindow, win) => {
        this.updateFilePathVisibility();
        // Popout windows have their own document.
        listen(win.document);
      }),
    );
  }

  openCmdkModal(initialFilters?: string[]) {
    this.ensurePatched();
    if (this.cmdkModal) {
      this.cmdkModal.close();
    }
    this.cmdkModal = new PaneSearchCmdkModal(this, initialFilters);
    this.cmdkModal.open();
  }

  updateFilePathVisibility() {
    const { showFilePath } = this.settings;
    for (const win of EmbeddedView.activeWindows(this)) {
      win.document.body.toggleClass("show-file-path", showFilePath);
    }
  }

  changeFilePathVisibility() {
    this.settings.showFilePath = !this.settings.showFilePath;
    this.updateFilePathVisibility();
    this.applySettingsUpdate();
  }

  // ── Exclusion helpers ──────────────────────────────────────────────
  withExclusion(query: string): string {
    return withExclusion(this.settings, query);
  }

  stripExclusion(query: string): string {
    return stripExclusion(this.settings, query);
  }

  // ── Saved searches ────────────────────────────────────────────────
  // One palette command per preset, keyed by the preset's stable id (not its
  // name), so hotkeys survive renames and non-Latin names cannot collide.
  private savedSearchCommands = new Map<string, string>();

  syncSavedSearchCommands() {
    const presets = new Map(this.settings.savedSearches.map((s) => [s.id, s]));
    for (const [id, name] of this.savedSearchCommands) {
      if (presets.get(id)?.name === name) continue;
      this.app.commands.removeCommand(`${this.manifest.id}:savedsearch-${id}`);
      this.savedSearchCommands.delete(id);
    }
    for (const preset of presets.values()) {
      if (this.savedSearchCommands.has(preset.id)) continue;
      this.savedSearchCommands.set(preset.id, preset.name);
      this.addCommand({
        id: `savedsearch-${preset.id}`,
        name: strings().savedSearchCmd(preset.name),
        callback: () => {
          const latest = this.settings.savedSearches.find(
            (s) => s.id === preset.id,
          );
          if (latest) this.openCmdkModal([latest.query]);
        },
      });
    }
  }

  async addSavedSearch(name: string, query: string) {
    this.settings.savedSearches.push({ id: newSavedSearchId(), name, query });
    await this.saveSettings();
    this.syncSavedSearchCommands();
  }

  private async openInLeaf(type: PaneType | "sidebar", state?: SearchState) {
    const leaf =
      type === "sidebar"
        ? this.app.workspace.getLeftLeaf(false)
        : this.app.workspace.getLeaf(type);
    leaf?.setPinned(type !== "sidebar");
    await leaf?.setViewState({
      type: "search",
      active: true,
      state: {
        ...DEFAULT_SETTINGS.searchViewState,
        ...state,
        query: this.withExclusion(
          new SearchFilter(this.app).toNativeQuery(state?.query ?? ""),
        ),
        triggerBySelf: true,
      },
    });

    window.setTimeout(() => {
      leaf?.containerEl.getElementsByTagName("input")[0]?.focus();
    }, 0);
  }

  /** Open the pane search in the given (default: configured) view. */
  openSearch(
    state: SearchState,
    viewType: SearchType = this.settings.defaultViewType,
    clearQuery = false,
  ): Promise<void> {
    if (viewType === "modal") {
      this.initModal(state, true, clearQuery);
      return Promise.resolve();
    }
    this.ensurePatched();
    return this.openInLeaf(
      viewType,
      clearQuery ? { ...state, query: "" } : state,
    );
  }

  initState() {
    // Initialize state with all default properties.
    // We intentionally do NOT inherit the persisted `query` from
    // settings.searchViewState, so the pane search always opens with a
    // global (empty) scope. Folder/tag restrictions (path:/tag:) are only
    // applied when the user types them or picks a saved search chip.
    this.state = {
      ...DEFAULT_SETTINGS.searchViewState,
      ...this.settings.searchViewState,
      query: "",
    };
  }

  initModal(state: SearchState, stateSave = false, clearQuery = false) {
    this.ensurePatched();
    if (this.modal) {
      this.modal.close();
    }

    this.modal = new PaneSearchModal(
      (state) => {
        // Preserve all state properties when updating from modal
        this.state = {
          ...DEFAULT_SETTINGS.searchViewState,
          ...state,
        };
        if (stateSave) this.applyStateUpdate();
        this.settings.searchViewState = { ...this.state, query: "" };
        this.applySettingsUpdate();
      },
      this,
      { ...state, query: clearQuery ? "" : state.query },
    );
    this.modal.open();
  }

  patchWorkspace() {
    let layoutChanging = false;
    // Keep the plugin receiver across native method wrappers.
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the wrappers below need the plugin, but `this` is the patched object
    const self = this;
    const uninstaller = around(Workspace.prototype, {
      getLeaf: (next) =>
        function (this: Workspace, ...args: Parameters<Workspace["getLeaf"]>) {
          const activeLeaf = self.app.workspace.getActiveViewOfType(View)?.leaf;
          if (activeLeaf?.parent) {
            const fsCtnEl = activeLeaf.parent.containerEl.parentElement;
            if (fsCtnEl?.hasClass("fs-content")) {
              if (activeLeaf.view.getViewType() === "markdown") {
                return activeLeaf;
              }

              const newLeaf = self.app.workspace.getMostRecentLeaf();

              if (newLeaf) {
                this.setActiveLeaf(newLeaf, {});
              }
            }
          }
          return next.apply(this, args);
        },
      changeLayout(old) {
        return async function (workspace: unknown) {
          layoutChanging = true;
          try {
            // Don't consider hover popovers part of the workspace while it's changing
            await old.call(this, workspace);
          } finally {
            layoutChanging = false;
          }
        };
      },
      iterateLeaves(native) {
        type leafIterator = (item: WorkspaceLeaf) => boolean | undefined;
        // Obsidian accepts (callback, item) and, in older versions, (item, callback).
        const old = native as unknown as (
          this: Workspace,
          ...args: unknown[]
        ) => boolean | undefined;
        return function (this: Workspace, arg1: unknown, arg2: unknown) {
          // Fast exit if desired leaf found
          if (old.call(this, arg1, arg2)) return true;

          // Handle old/new API parameter swap
          const cb: leafIterator = (
            typeof arg1 === "function" ? arg1 : arg2
          ) as leafIterator;
          const parent: WorkspaceItem = (
            typeof arg1 === "function" ? arg2 : arg1
          ) as WorkspaceItem;

          if (!parent) return false; // <- during app startup, rootSplit can be null
          if (layoutChanging) return false; // Don't let HEs close during workspace change

          // 0.14.x doesn't have WorkspaceContainer; this can just be an instanceof check once 15.x is mandatory:

          if (!requireApiVersion("0.15.0")) {
            if (
              parent === self.app.workspace.rootSplit ||
              (WorkspaceContainer && parent instanceof WorkspaceContainer)
            ) {
              for (const popover of EmbeddedView.popoversForWindow(
                (parent as WorkspaceContainer).win,
              )) {
                // Use old API here for compat w/0.14.x
                if (old.call(this, cb, popover.rootSplit)) return false;
              }
            }
          }
          return false;
        };
      },
      pushUndoHistory(old) {
        return function (leaf: WorkspaceLeaf, id: string, ...args: unknown[]) {
          const viewState = leaf.getViewState();
          if (viewState.type === "search") {
            return;
          }
          return old.call(this, leaf, id, ...args);
        };
      },
    });
    this.register(uninstaller);
    this.register(
      around(Workspace.prototype as unknown as ActivatableWorkspace, {
        setActiveLeaf(old) {
          return function (
            this: Workspace,
            leaf: WorkspaceLeaf,
            params?: { focus?: boolean },
          ) {
            if (isEmbeddedLeaf(leaf)) {
              old.call(this, leaf, params);
              leaf.activeTime = 1700000000000;
            }
            return old.call(this, leaf, params);
          };
        },
      }),
    );
  }

  // Used for patch workspaceleaf pinned behaviors
  patchWorkspaceLeaf() {
    const { app } = this;
    this.register(
      around(WorkspaceLeaf.prototype, {
        getRoot(old) {
          return function (this: WorkspaceLeaf) {
            const top = old.call(this);
            return top?.getRoot === this.getRoot ? top : top?.getRoot();
          };
        },
        setPinned(old) {
          return function (this: WorkspaceLeaf, pinned: boolean) {
            old.call(this, pinned);
            if (isEmbeddedLeaf(this) && !pinned) this.setPinned(true);
          };
        },
        openFile(old) {
          return function (
            this: WorkspaceLeaf,
            file: TFile,
            openState?: OpenViewState,
          ) {
            if (isEmbeddedLeaf(this)) {
              window.setTimeout(
                around(Workspace.prototype, {
                  recordMostRecentOpenedFile(old) {
                    return function (_file: TFile) {
                      // Don't update the quick switcher's recent list
                      if (_file !== file) {
                        return old.call(this, _file);
                      }
                    };
                  },
                }),
                1,
              );
              const recentFiles = app.plugins.plugins["recent-files-obsidian"];
              if (recentFiles) {
                window.setTimeout(
                  around(recentFiles, {
                    shouldAddFile(old) {
                      return function (_file: TFile) {
                        // Don't update the Recent Files plugin
                        return _file !== file && old.call(this, _file);
                      };
                    },
                  }),
                  1,
                );
              }
            }

            const view = old.call(this, file, openState);
            window.setTimeout(() => {
              const fsCtnEl = this.parent?.containerEl?.parentElement;
              if (!fsCtnEl?.classList.contains("fs-content")) return;
              if (file.extension !== "canvas") return;

              const canvas = (this.view as CanvasLeafView).canvas;
              const wanted = (
                openState?.eState as
                  | { match?: { content?: string } }
                  | undefined
              )?.match?.content;
              window.setTimeout(() => {
                if (!canvas || wanted === undefined) return;
                const found = canvas.data.nodes?.find((n) => n.text === wanted);
                const node = found && canvas.nodes.get(found.id);
                if (node) {
                  canvas.selectOnly(node);
                  canvas.zoomToSelection();
                }
              }, 20);
            }, 1);

            return view;
          };
        },
      }),
    );
  }

  patchSearchView() {
    const checkCurrentViewType = (leaf: WorkspaceLeaf) => {
      const isModal =
        activeDocument.querySelector(".pane-search-modal") !== null;
      const currentLeafRoot = leaf.getRoot();
      if (
        currentLeafRoot?.side &&
        (currentLeafRoot?.side === "left" || currentLeafRoot?.side === "right")
      )
        return "sidebar";
      if (leaf.getContainer()?.type === "window") return "window";
      return isModal ? "modal" : "split";
    };

    const initViewMenu = (
      menu: Menu,
      current: SearchType,
      originLeaf?: WorkspaceLeaf,
    ) => {
      menu.dom.toggleClass("pane-search-view-menu", true);
      const availableViews = allViews.filter((view) => {
        if (current === "split") {
          return view.type !== "tab";
        } else {
          return view.type !== current;
        }
      });
      for (const view of availableViews) {
        menu.addItem((item: MenuItem) => {
          item
            .setTitle(strings().viewTypeMenu(view.type))
            .setIcon(`${view.icon}`)
            .onClick(async () => {
              if (view.type === "modal") {
                originLeaf?.detach();
                window.setTimeout(() => {
                  this.initModal(this.state, true, false);
                }, 10);
              } else if (view.type === "sidebar") {
                await this.openInLeaf(view.type, this.state);
              } else {
                if (current === "window") {
                  originLeaf?.detach();
                  window.setTimeout(() => {
                    void this.openInLeaf(
                      <"tab" | "split">view.type,
                      this.state,
                    );
                  }, 10);
                } else {
                  await this.openInLeaf(view.type, this.state);
                }
              }
              if (current === "modal") {
                this.modal.close();
              } else {
                originLeaf?.detach();
              }
            });
        });
      }
      return menu;
    };

    // `layout-change` can fire again while the first patch is still awaiting
    // a deferred view, so patching must be single-flight.
    let patched = false;
    let patching = false;
    const patchSearch = async () => {
      if (patched) return true;
      if (patching) return false;
      const searchLeaf = this.app.workspace.getLeavesOfType("search")[0];
      if (!searchLeaf) return false;
      patching = true;
      try {
        return await patchSearchViewOf(searchLeaf);
      } finally {
        patching = false;
      }
    };

    const patchSearchViewOf = async (searchLeaf: WorkspaceLeaf) => {
      if (requireApiVersion("1.7.3") && searchLeaf.isDeferred) {
        await searchLeaf.loadIfDeferred();
      }

      const searchView = searchLeaf?.view as SearchView | undefined;
      // Keep the plugin receiver across native method wrappers.
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- the wrappers below need the plugin, but `this` is the patched object
      const self = this;

      if (!searchView) return false;

      const searchViewPrototype = Object.getPrototypeOf(
        searchView,
      ) as SearchViewPrototype;

      this.register(
        around(searchViewPrototype, {
          onOpen(old) {
            return function (this: SearchView) {
              old.call(this);

              const viewSwitchEl = createDiv({
                cls: "pane-search-view-switch",
              });
              const targetEl = this.filterSectionToggleEl;
              const viewSwitchButton = new ExtraButtonComponent(viewSwitchEl);
              viewSwitchButton
                .setIcon("layout-template")
                .setTooltip(strings().switchToFileView);
              viewSwitchButton.onClick(() => {
                const currentType = checkCurrentViewType(this.leaf);
                const layoutMenu = initViewMenu(
                  new Menu(),
                  currentType,
                  this.leaf,
                );
                const viewSwitchButtonPos =
                  viewSwitchEl.getBoundingClientRect();
                layoutMenu.showAtPosition({
                  x: viewSwitchButtonPos.x,
                  y: viewSwitchButtonPos.y + 30,
                });
              });
              // Remove any previously inserted switch button first so
              // repeated rebuilds (rebuildView -> onOpen) don't stack
              // multiple copies and bloat the search view DOM.
              const container = targetEl.parentElement;
              container?.querySelector(".pane-search-view-switch")?.remove();
              container?.insertBefore(viewSwitchEl, targetEl);
              if (!this.hidePathToggle) {
                this.hidePathToggle = new Setting(this.searchParamsContainerEl)
                  .setName(strings().showFilePath)
                  .addToggle((toggle) => {
                    toggle.toggleEl.toggleClass("mod-small", true);
                    toggle
                      .setValue(self.settings.showFilePath)
                      .onChange(async (value) => {
                        self.settings.showFilePath = !value;
                        self.changeFilePathVisibility();
                        self.applySettingsUpdate();
                      });
                  });
              }
              if (!this.showInstructionsToggle) {
                this.showInstructionsToggle = new Setting(
                  this.searchParamsContainerEl,
                )
                  .setName(strings().showInstructions)
                  .addToggle((toggle) => {
                    toggle.toggleEl.toggleClass("mod-small", true);
                    toggle
                      .setValue(self.settings.showInstructions)
                      .onChange(async (value) => {
                        self.settings.showInstructions = value;
                        self.applySettingsUpdate();
                      });
                  });
              }
              if (!this.defaultViewTypeDropdown) {
                this.defaultViewTypeDropdown = new Setting(
                  this.searchParamsContainerEl,
                )
                  .setName(strings().defaultViewType)
                  .addDropdown((dropdown) => {
                    const viewLabels = strings().viewType;
                    dropdown.addOptions({
                      modal: viewLabels.modal,
                      split: viewLabels.split,
                      tab: viewLabels.tab,
                      window: viewLabels.window,
                      sidebar: viewLabels.sidebar,
                    });
                    dropdown.setValue(self.settings.defaultViewType);
                    dropdown.onChange((value) => {
                      self.settings.defaultViewType = value as SearchType;
                      self.applySettingsUpdate();
                    });
                  });
              }
            };
          },
          setExplainSearch(old) {
            return function (this: SearchView, value: boolean) {
              old.call(this, value);
              self.persistViewState({ explainSearch: value });
            };
          },
          setCollapseAll(old) {
            return function (this: SearchView, value: boolean) {
              old.call(this, value);
              self.persistViewState({ collapseAll: value });
            };
          },
          setExtraContext(old) {
            return function (this: SearchView, value: boolean) {
              old.call(this, value);
              self.persistViewState({ extraContext: value });
            };
          },
          setMatchingCase(old) {
            return function (this: SearchView, value: boolean) {
              old.call(this, value);
              self.persistViewState({ matchingCase: value });
            };
          },
          setSortOrder(old) {
            return function (this: SearchView, value: string) {
              old.call(this, value);
              self.persistViewState({ sortOrder: value as SortOrder });
            };
          },
          setState(old) {
            return function (
              this: SearchView,
              state: SearchViewState,
              eState: unknown,
            ) {
              if (typeof state.query === "string" && !state.triggerBySelf) {
                if (self.queryLoaded) {
                  // Re-route an external query to a Pane Search,
                  // but guard against re-entrant spawning (which
                  // would recurse) and against spawning again for
                  // the SAME query (which would otherwise loop
                  // endlessly and freeze Obsidian).
                  if (
                    state.query &&
                    !self.routing &&
                    !self.isDuplicateRoute(state.query)
                  ) {
                    self.routing = true;
                    try {
                      void self.openSearch({
                        ...state,
                        query: state.query,
                        current: false,
                        triggerBySelf: true,
                      });
                    } finally {
                      self.routing = false;
                    }
                  }
                  // The Pane Search takes over; do NOT apply the
                  // query to the native view (matches original
                  // behaviour and avoids a second redundant search).
                  return;
                }

                self.queryLoaded = true;
              }

              old.call(this, state, eState);
            };
          },
        }),
      );
      // Rebuilding replays the view's state through the patched setters; that
      // must not overwrite the saved pane-search state.
      this.suppressViewStatePersist = true;
      searchView.leaf?.rebuildView();
      window.setTimeout(() => {
        this.suppressViewStatePersist = false;
      }, 250);
      patched = true;
      return true;
    };
    this.app.workspace.onLayoutReady(async () => {
      if (!(await patchSearch())) {
        const evt = this.app.workspace.on("layout-change", () => {
          void patchSearch().then((done) => {
            if (done) this.app.workspace.offref(evt);
          });
        });
        this.registerEvent(evt);
      }
    });
  }

  patchVchildren() {
    const patchSearchDom = () => {
      const searchView = this.app.workspace.getLeavesOfType("search")[0]
        ?.view as SearchView | undefined;
      if (!searchView) return false;

      const domPrototype = Object.getPrototypeOf(
        searchView.dom,
      ) as SearchResultDom;

      this.register(
        around(domPrototype, {
          stopLoader(old) {
            return function (this: SearchResultDom) {
              old.call(this);
              this.vChildren?.children?.forEach((child) => {
                if (child.file && !child.pathEl) {
                  const path = child.file.parent?.path || "/";
                  const pathEl = createDiv({
                    cls: "search-result-file-path",
                  });
                  const pathIconEl = pathEl.createDiv({
                    cls: "search-result-file-path-icon",
                  });
                  setIcon(pathIconEl, "folder");
                  pathEl.createDiv({
                    cls: "search-result-file-path-text",
                    text: path,
                  });
                  child.pathEl = pathEl;
                  child.containerEl
                    .find(".search-result-file-title")
                    ?.prepend(pathEl);
                }
              });
            };
          },
        }),
      );
      return true;
    };
    this.app.workspace.onLayoutReady(() => {
      if (!patchSearchDom()) {
        const evt = this.app.workspace.on("layout-change", () => {
          patchSearchDom() && this.app.workspace.offref(evt);
        });
        this.registerEvent(evt);
      }
    });
  }

  patchDragManager() {
    const manager = this.app.dragManager;
    if (!manager) return;
    // Keep the plugin receiver across native method wrappers.
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the wrappers below need the plugin, but `this` is the patched object
    const self = this;

    this.register(
      around(Object.getPrototypeOf(manager) as DragManager, {
        dragFile(old) {
          return function (e: DragEvent, a: TFile) {
            const result = old.call(this, e, a);

            window.setTimeout(() => {
              self?.modal?.close();
            }, 10);
            return result;
          };
        },
      }),
    );
  }

  registerObsidianURIHandler() {
    /**
     * Handles obsidian://fs protocol for search functionality
     *
     * @param viewType - Where to open search:
     *   - "modal" (default) - Opens in modal popup
     *   - "tab" - Opens in new tab
     *   - "split" - Opens in split pane
     *   - "window" - Opens in new window
     *   - "sidebar" - Opens in sidebar
     * @param query - Search query string
     *
     * Examples:
     * obsidian://fs?query=hello&viewType=modal
     * obsidian://fs?query=world&viewType=tab
     * obsidian://fs?query=test (defaults to modal)
     */
    this.registerObsidianProtocolHandler(
      "fs",
      async (path: ObsidianProtocolData) => {
        const viewType = parseViewType(path.viewType) ?? "modal";
        const query = path.query || "";
        await this.openSearch(
          { ...this.state, query, current: false },
          viewType,
        );
      },
    );
  }

  private createCommand(options: {
    id: string;
    name: string;
    queryBuilder: (file?: TFile) => string;
    vaultWide: boolean;
  }): void {
    const open = (query: string) =>
      void this.openSearch({ ...this.state, query, current: true });

    if (options.vaultWide) {
      this.addCommand({
        id: options.id,
        name: options.name,
        callback: () => open(options.queryBuilder()),
      });
      return;
    }

    this.addCommand({
      id: options.id,
      name: options.name,
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || (file.extension !== "md" && file.extension !== "canvas")) {
          return false;
        }
        if (!checking) open(options.queryBuilder(file));
        return true;
      },
    });
  }

  registerObsidianCommands() {
    this.addCommand({
      id: "show-or-hide-file-path",
      name: strings().cmdShowHideFilePath,
      callback: () => {
        this.changeFilePathVisibility();
      },
    });

    this.addCommand({
      id: "search-obsidian-globally",
      name: strings().cmdSearchGlobally,
      callback: () =>
        this.initModal(
          { ...this.state, query: "", current: false },
          false,
          true,
        ),
    });

    this.addCommand({
      id: "search-obsidian-globally-state",
      name: strings().cmdSearchGloballyState,
      callback: () =>
        this.initModal(
          { ...this.state, query: this.state.query, current: false },
          true,
          false,
        ),
    });

    this.createCommand({
      id: "search-in-backlink",
      name: strings().cmdSearchBacklink,
      queryBuilder: (file?: TFile) => {
        if (!file) return "";
        return (
          " /\\[\\[" +
          escapeRegex(file.extension === "canvas" ? file.name : file.basename) +
          "(\\|[^\\]]*)?\\]\\]/"
        );
      },
      vaultWide: false,
    });

    this.createCommand({
      id: "search-in-current-file",
      name: strings().cmdSearchCurrentFile,
      queryBuilder: (file?: TFile) => {
        if (!file) return "";
        return ` path:"${file.path}"`;
      },
      vaultWide: false,
    });

    // Register search operator commands
    this.registerSearchOperatorCommands();

    for (const type of ["split", "tab", "window"] as PaneType[]) {
      this.addCommand({
        id: `open-search-view-${type}`,
        name: strings().cmdOpenSearchView(type),
        callback: () => void this.openSearchView(type),
      });
    }

    this.syncSavedSearchCommands();
  }

  /** Open a search view of the given kind, reusing an existing one when there is one. */
  private async openSearchView(type: PaneType) {
    const state = { ...this.state, triggerBySelf: true };
    const existing = this.app.workspace
      .getLeavesOfType("search")
      .find((leaf) =>
        type === "window"
          ? leaf.getContainer()?.type === "window"
          : !leaf.getRoot()?.side,
      );
    if (!existing) {
      await this.openInLeaf(type, state);
      return;
    }
    await this.app.workspace.revealLeaf(existing);
    if (type !== "window") {
      await existing.setViewState({ type: "search", active: true, state });
    }
  }

  registerSearchOperatorCommands() {
    const s = strings();
    const searchOperators = [
      {
        id: "search-file-operator",
        name: s.cmdSearchFile,
        query: "file:",
      },
      {
        id: "search-path-operator",
        name: s.cmdSearchPath,
        query: "path:",
      },
      {
        id: "search-content-operator",
        name: s.cmdSearchContent,
        query: "content:",
      },
      {
        id: "search-match-case-operator",
        name: s.cmdSearchMatchCase,
        query: "match-case:",
      },
      {
        id: "search-ignore-case-operator",
        name: s.cmdSearchIgnoreCase,
        query: "ignore-case:",
      },
      {
        id: "search-tag-operator",
        name: s.cmdSearchTag,
        query: "tag:",
      },
      {
        id: "search-line-operator",
        name: s.cmdSearchLine,
        query: "line:",
      },
      {
        id: "search-block-operator",
        name: s.cmdSearchBlock,
        query: "block:",
      },
      {
        id: "search-section-operator",
        name: s.cmdSearchSection,
        query: "section:",
      },
      {
        id: "search-task-operator",
        name: s.cmdSearchTask,
        query: "task:",
      },
      {
        id: "search-task-todo-operator",
        name: s.cmdSearchTaskTodo,
        query: "task-todo:",
      },
      {
        id: "search-task-done-operator",
        name: s.cmdSearchTaskDone,
        query: "task-done:",
      },
      {
        id: "search-property",
        name: s.cmdSearchProperty,
        query: "[]",
      },
    ];

    // Register all search operator commands
    searchOperators.forEach((operator) => {
      this.createCommand({
        id: operator.id,
        name: operator.name,
        queryBuilder: () => operator.query || "",
        vaultWide: true,
      });
    });
  }

  registerEditorMenuHandler() {
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
        if (!editor) {
          return;
        }
        if (editor.getSelection().length === 0) {
          return;
        }
        const selection = editor.getSelection().trim();
        const searchWord =
          selection.length > 8
            ? `${selection.slice(0, 3)}...${selection.slice(-3)}`
            : selection;

        menu.addItem((item) => {
          // Add sub menu
          item
            .setTitle(strings().menuSearchInPane(searchWord))
            .setIcon("search")
            .onClick(() =>
              this.initModal(
                {
                  ...this.state,
                  query: selection,
                  current: false,
                },
                true,
                false,
              ),
            );
        });
      }),
    );
  }

  registerContextMenuHandler() {
    this.registerEvent(
      this.app.workspace.on(
        "file-menu",
        (
          menu: Menu,
          file: TAbstractFile,
          _source: string,
          leaf?: WorkspaceLeaf,
        ) => {
          const popover = leaf ? EmbeddedView.forLeaf(leaf) : undefined;
          if (file instanceof TFile && !popover && !leaf) {
            menu.addItem((item) => {
              item
                .setIcon("popup-open")
                .setTitle(strings().menuOpenInPanePreview)
                .onClick(async () => {
                  if (this.modal) {
                    await this.modal.initFileView(file, undefined);

                    return;
                  }

                  this.initModal({ ...this.state, current: false }, true, true);
                  window.setTimeout(() => {
                    void this.modal.initFileView(file, undefined);
                  }, 20);
                })
                .setSection?.("open");
            });
          }
        },
      ),
    );
  }

  registerIcons() {
    // Phosphor Bold: app-window + magnifying-glass (MIT)
    // https://phosphoricons.com/  256 viewBox scaled into Obsidian's 100x100 icon slot
    addIcon(
      "pane-search-window",
      `<g transform="translate(3 10) scale(0.275)" fill="currentColor"><path d="M216,36H40A20,20,0,0,0,20,56V200a20,20,0,0,0,20,20H216a20,20,0,0,0,20-20V56A20,20,0,0,0,216,36Zm-4,160H44V60H212ZM60,92a16,16,0,1,1,16,16A16,16,0,0,1,60,92Zm48,0a16,16,0,1,1,16,16A16,16,0,0,1,108,92Z"/></g><g transform="translate(38 38) scale(0.24)" fill="currentColor"><path d="M232.49,215.51,185,168a92.12,92.12,0,1,0-17,17l47.53,47.54a12,12,0,0,0,17-17ZM44,112a68,68,0,1,1,68,68A68.07,68.07,0,0,1,44,112Z"/></g>`,
    );
    addIcon(
      "panel-left-inactive",
      `<path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 4.999687 3 L 19.000312 3 C 20.104688 3 21 3.895312 21 4.999687 L 21 19.000312 C 21 20.104688 20.104688 21 19.000312 21 L 4.999687 21 C 3.895312 21 3 20.104688 3 19.000312 L 3 4.999687 C 3 3.895312 3.895312 3 4.999687 3 Z M 4.999687 3 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 9 13.999688 L 9 15 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 9 19.000312 L 9 21 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 9 3 L 9 4.999687 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 9 9 L 9 10.000312 " transform="matrix(4.166667,0,0,4.166667,0,0)"/>`,
    );
    addIcon(
      "app-window",
      `<path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 4.000312 4.000312 L 19.999688 4.000312 C 21.105 4.000312 22.000312 4.895625 22.000312 6 L 22.000312 18 C 22.000312 19.104375 21.105 19.999688 19.999688 19.999688 L 4.000312 19.999688 C 2.895 19.999688 1.999687 19.104375 1.999687 18 L 1.999687 6 C 1.999687 4.895625 2.895 4.000312 4.000312 4.000312 Z M 4.000312 4.000312 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 10.000312 4.000312 L 10.000312 7.999687 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 1.999687 7.999687 L 22.000312 7.999687 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 6 4.000312 L 6 7.999687 " transform="matrix(4.166667,0,0,4.166667,0,0)"/>`,
    );
    addIcon(
      "panel-top",
      `<path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 4.999687 3 L 19.000312 3 C 20.104688 3 21 3.895312 21 4.999687 L 21 19.000312 C 21 20.104688 20.104688 21 19.000312 21 L 4.999687 21 C 3.895312 21 3 20.104688 3 19.000312 L 3 4.999687 C 3 3.895312 3.895312 3 4.999687 3 Z M 4.999687 3 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 3 9 L 21 9 " transform="matrix(4.166667,0,0,4.166667,0,0)"/>`,
    );
    addIcon(
      "square-equal",
      `<path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 4.999687 3 L 19.000312 3 C 20.104688 3 21 3.895312 21 4.999687 L 21 19.000312 C 21 20.104688 20.104688 21 19.000312 21 L 4.999687 21 C 3.895312 21 3 20.104688 3 19.000312 L 3 4.999687 C 3 3.895312 3.895312 3 4.999687 3 Z M 4.999687 3 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 7.000312 10.000312 L 16.999688 10.000312 " transform="matrix(4.166667,0,0,4.166667,0,0)"/><path style="fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke:currentColor;stroke-opacity:1;stroke-miterlimit:4;" d="M 7.000312 13.999688 L 16.999688 13.999688 " transform="matrix(4.166667,0,0,4.166667,0,0)"/>`,
    );
  }

  async loadSettings() {
    this.settings = sanitizeSettings(await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
