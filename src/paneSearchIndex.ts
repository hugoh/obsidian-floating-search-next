import { around } from "monkey-around";
import {
  addIcon,
  type DragManager,
  debounce,
  Editor,
  type ObsidianProtocolData,
  type OpenViewState,
  Plugin,
  TFile,
  View,
  Workspace,
  WorkspaceLeaf,
} from "obsidian";
import { strings } from "./i18n";
import { isEmbeddedLeaf } from "./leafView";
import { type Caret, PaneSearchModal } from "./nativeModal";
import {
  DEFAULT_SETTINGS,
  type PaneSearchSettings,
  type SearchState,
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

  public applySettingsUpdate = debounce(async () => {
    await this.saveSettings();
  }, 1000);

  private lastCaret: Caret | undefined;

  /** "With Last State" restores the last query only for this long. */
  private forgetQuery = debounce(() => {
    this.state = { ...this.state, query: "" };
    this.lastCaret = undefined;
  }, 30000);

  async onload() {
    await this.loadSettings();
    this.initState();

    this.registerIcons();
    this.registerObsidianURIHandler();
    this.registerObsidianCommands();

    this.addRibbonIcon("pane-search-window", strings().ribbonSearch, () =>
      this.initModal({ ...this.state, query: "" }),
    );
    this.addSettingTab(new PaneSearchSettingTab(this.app, this));
  }

  onunload() {
    // Saving is debounced; do not drop a change made just before unloading.
    void this.applySettingsUpdate.run();
    this.modal?.close();
  }

  // The monkeypatches are only needed once a search is opened, so they are
  // applied on first use rather than at startup.
  private patched = false;
  private ensurePatched() {
    if (this.patched) return;
    this.patched = true;
    this.patchWorkspace();
    this.patchWorkspaceLeaf();
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

  initState() {
    // The persisted query is never restored, so a search always opens global.
    this.state = {
      ...DEFAULT_SETTINGS.searchViewState,
      ...this.settings.searchViewState,
      query: "",
    };
  }

  initModal(state: SearchState, caret?: Caret) {
    this.ensurePatched();
    this.modal?.close();

    this.modal = new PaneSearchModal(
      (closing, closingCaret) => {
        this.state = { ...DEFAULT_SETTINGS.searchViewState, ...closing };
        this.lastCaret = closingCaret;
        this.settings.searchViewState = { ...this.state, query: "" };
        this.applySettingsUpdate();
        this.forgetQuery();
      },
      this,
      state,
      caret,
    );
    this.modal.open();
  }

  patchWorkspace() {
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
              self.modal?.close();
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
      this.initModal({ ...this.state, query: path.query || "" });
    });
  }

  registerObsidianCommands() {
    this.addCommand({
      id: "search-obsidian-globally",
      name: strings().cmdSearchGlobally,
      callback: () => this.initModal({ ...this.state, query: "" }),
    });

    this.addCommand({
      id: "search-obsidian-globally-state",
      name: strings().cmdSearchGloballyState,
      callback: () => this.initModal(this.state, this.lastCaret),
    });
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
