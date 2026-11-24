import { around } from "monkey-around";
import {
  addIcon,
  type DragManager,
  debounce,
  Editor,
  Menu,
  type ObsidianProtocolData,
  type OpenViewState,
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
import { strings } from "./i18n";
import { EmbeddedView, isEmbeddedLeaf } from "./leafView";
import { PaneSearchModal } from "./nativeModal";
import {
  DEFAULT_SETTINGS,
  type PaneSearchSettings,
  type SearchState,
  type SortOrder,
  sanitizeSettings,
} from "./settings";
import { PaneSearchSettingTab } from "./settingsTab";

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

/** Methods of the native search view that Obsidian does not declare. */
interface SearchViewPrototype {
  onOpen(): unknown;
  setExplainSearch(value: boolean): void;
  setCollapseAll(value: boolean): void;
  setExtraContext(value: boolean): void;
  setMatchingCase(value: boolean): void;
  setSortOrder(value: string): void;
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

  /** True while a freshly patched search view rebuilds itself. */
  private suppressViewStatePersist = false;

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
    this.registerEvent(
      this.app.workspace.on("window-open", () =>
        this.updateFilePathVisibility(),
      ),
    );

    this.registerObsidianURIHandler();
    this.registerObsidianCommands();
    this.registerEditorMenuHandler();
    this.registerContextMenuHandler();

    this.addRibbonIcon("pane-search-window", strings().ribbonSearch, () =>
      this.initModal(this.state, true, true),
    );
    this.updateFilePathVisibility();
    this.addSettingTab(new PaneSearchSettingTab(this.app, this));
  }

  onunload() {
    // this.state = DEFAULT_SETTINGS.searchViewState;
    // Saving is debounced; do not drop a change made just before unloading.
    void this.applySettingsUpdate.run();
    this.modal?.close();
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
     * Handles obsidian://fs?query=... by opening the search modal.
     */
    this.registerObsidianProtocolHandler("fs", (path: ObsidianProtocolData) => {
      this.initModal({
        ...this.state,
        query: path.query || "",
        current: false,
      });
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
  }

  async loadSettings() {
    this.settings = sanitizeSettings(await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
