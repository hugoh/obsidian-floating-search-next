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
import { type Caret, SearchOpenModal } from "./nativeModal";
import {
  type SearchOpenSettings,
  type SearchState,
  sanitizeSettings,
} from "./settings";
import { SearchOpenSettingTab } from "./settingsTab";

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

/** Selects and zooms to the canvas card whose text a search result matched. */
function selectMatchedCard(
  leaf: WorkspaceLeaf,
  file: TFile,
  openState?: OpenViewState,
) {
  const view = leaf.view as CanvasLeafView & { file?: TFile };
  if (view.file !== file || !view.canvas) return;
  const wanted = (
    openState?.eState as { match?: { content?: string } } | undefined
  )?.match?.content;
  if (wanted === undefined) return;
  const { canvas } = view;
  const found = canvas.data.nodes?.find((node) => node.text === wanted);
  const card = found && canvas.nodes.get(found.id);
  if (!card) return;
  canvas.selectOnly(card);
  canvas.zoomToSelection();
}

/** Runs `fn` until it has completed once; a run that throws is retried. */
function once(fn: () => void) {
  let done = false;
  return () => {
    if (done) return;
    fn();
    done = true;
  };
}

export default class SearchOpenPlugin extends Plugin {
  settings: SearchOpenSettings;
  private state: SearchState;
  private modal: SearchOpenModal | undefined;

  private applySettingsUpdate = debounce(async () => {
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

    this.addRibbonIcon("search-open-window", strings.ribbonSearch, () =>
      this.initModal({ ...this.state, query: "" }),
    );
    this.addSettingTab(new SearchOpenSettingTab(this.app, this));
  }

  onunload() {
    // Closing the modal queues a save of its final state; flush it, and drop
    // the pending "forget the last query" timer so nothing outlives the plugin.
    this.modal?.close();
    void this.applySettingsUpdate.run();
    this.forgetQuery.cancel();
  }

  // The monkeypatches are only needed once a search is opened, so they are
  // applied on first use rather than at startup.
  private readonly ensurePatched = once(() => {
    this.patchWorkspace();
    this.patchWorkspaceLeaf();
    this.patchRecentFileTracker();
    this.patchDragManager();
    this.patchEditorHighlights();
  });

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
    const proto = Editor.prototype;
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

  /** The sanitized settings never hold a query, so a search opens global. */
  private initState() {
    this.state = { ...this.settings.searchViewState };
  }

  private initModal(state: SearchState, caret?: Caret) {
    this.ensurePatched();
    this.modal?.close();

    const modal: SearchOpenModal = new SearchOpenModal(
      (closing) => {
        if (this.modal === modal) this.modal = undefined;
        releaseRecentFiles();
        // Closed before the view took its state: there is nothing to remember.
        if (!closing) return;
        this.state = { ...this.state, ...closing.state };
        this.lastCaret = closing.caret;
        this.settings.searchViewState = { ...this.state, query: "" };
        this.applySettingsUpdate();
        this.forgetQuery();
      },
      this,
      state,
      caret,
    );
    const releaseRecentFiles = this.holdBackRecentFiles(modal);
    this.modal = modal;
    modal.open();
  }

  patchWorkspace() {
    // Keep the plugin receiver across native method wrappers.
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the wrappers below need the plugin, but `this` is the patched object
    const self = this;
    const uninstaller = around(Workspace.prototype, {
      getLeaf: (next) =>
        function (this: Workspace, ...args: Parameters<Workspace["getLeaf"]>) {
          const activeLeaf = self.app.workspace.getActiveViewOfType(View)?.leaf;
          if (activeLeaf && isEmbeddedLeaf(activeLeaf)) {
            if (activeLeaf.view.getViewType() === "markdown") {
              return activeLeaf;
            }

            const newLeaf = self.app.workspace.getMostRecentLeaf();

            if (newLeaf) {
              this.setActiveLeaf(newLeaf, {});
            }
          }
          return next.apply(this, args);
        },
      pushUndoHistory(old) {
        return function (leaf: WorkspaceLeaf, id: string, ...args: unknown[]) {
          if (isEmbeddedLeaf(leaf) && leaf.getViewState().type === "search") {
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
            const opened = old.call(this, file, openState);
            if (!isEmbeddedLeaf(this) || file.extension !== "canvas") {
              return opened;
            }
            return opened.then(() => selectMatchedCard(this, file, openState));
          };
        },
      }),
    );
  }

  /**
   * Obsidian records a file as recent when it stops being the active file, and
   * the preview leaf becomes the active leaf while it is shown. Leave out a file
   * that was only ever shown by an embedded leaf.
   */
  patchRecentFileTracker() {
    const { workspace } = this.app;
    const tracker = workspace.recentFileTracker;
    if (!tracker) return;
    let previewed: TFile | null = null;
    this.register(
      around(tracker, {
        onFileOpen: (old) =>
          function (
            this: unknown,
            newFile: TFile | null,
            oldFile: TFile | null,
          ) {
            const skip = oldFile !== null && oldFile === previewed;
            const active = workspace.getActiveViewOfType(View)?.leaf;
            previewed = active && isEmbeddedLeaf(active) ? newFile : null;
            return skip ? undefined : old.call(this, newFile, oldFile);
          },
      }),
    );
  }

  /**
   * The Recent Files plugin adds a file on `file-open` when its
   * `shouldAddFile` agrees. Keep previewed files out of its list while the modal
   * is open; the returned function ends that.
   */
  holdBackRecentFiles(modal: { hasPreviewed(file: TFile): boolean }) {
    const recentFiles = this.app.plugins.plugins["recent-files-obsidian"];
    if (!recentFiles) return () => {};
    return around(recentFiles, {
      shouldAddFile: (old) =>
        function (this: unknown, file: TFile) {
          return !modal.hasPreviewed(file) && old.call(this, file);
        },
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

            const modal = self.modal;
            window.setTimeout(() => modal?.close(), 10);
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
      name: strings.cmdSearchGlobally,
      callback: () => this.initModal({ ...this.state, query: "" }),
    });

    this.addCommand({
      id: "search-obsidian-globally-state",
      name: strings.cmdSearchGloballyState,
      callback: () => this.initModal(this.state, this.lastCaret),
    });
  }

  registerIcons() {
    // Phosphor Bold: app-window + magnifying-glass (MIT)
    // https://phosphoricons.com/  256 viewBox scaled into Obsidian's 100x100 icon slot
    addIcon(
      "search-open-window",
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
