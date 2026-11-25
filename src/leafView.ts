import {
  Component,
  type Workspace,
  type WorkspaceLeaf,
  WorkspaceSplit,
  WorkspaceTabs,
} from "obsidian";
import type SearchOpenPlugin from "src/main";

type ConstructableWorkspaceSplit = new (
  ws: Workspace,
  dir: "horizontal" | "vertical",
) => WorkspaceSplit;

export function isEmbeddedLeaf(leaf: WorkspaceLeaf | undefined) {
  if (!leaf) return false;
  return leaf.containerEl.matches(".search-open-embed .workspace-leaf");
}

function containerForDocument(doc: Document, plugin: SearchOpenPlugin) {
  const { floatingSplit, rootSplit } = plugin.app.workspace;
  if (doc !== window.document && floatingSplit) {
    for (const container of floatingSplit.children) {
      if (container.doc === doc) return container;
    }
  }
  return rootSplit;
}

/** Creates a real workspace leaf inside `targetEl`, outside the main layout. */
export function spawnLeafView(
  plugin: SearchOpenPlugin,
  targetEl: HTMLElement,
): [WorkspaceLeaf, EmbeddedView] {
  const view = new EmbeddedView(targetEl, plugin);
  return [view.attachLeaf(), view];
}

/**
 * A workspace split that lives in our own element. Obsidian needs the split's
 * root and container to resolve, so both point at the real workspace.
 */
export class EmbeddedView extends Component {
  private readonly hoverEl: HTMLElement;
  private readonly containerEl: HTMLElement;
  private readonly rootSplit: WorkspaceSplit;
  private readonly document: Document;

  constructor(
    targetEl: HTMLElement,
    private readonly plugin: SearchOpenPlugin,
  ) {
    super();
    this.document = targetEl.ownerDocument;
    this.rootSplit = new (WorkspaceSplit as ConstructableWorkspaceSplit)(
      plugin.app.workspace,
      "vertical",
    );
    this.hoverEl = targetEl.createDiv({ cls: "search-open-embed" });
    this.containerEl = this.hoverEl.createDiv("search-open-embed-content");
    this.load();
  }

  attachLeaf(): WorkspaceLeaf {
    const { workspace } = this.plugin.app;
    this.rootSplit.getRoot = () =>
      this.document === window.document
        ? workspace.rootSplit
        : (workspace.floatingSplit ?? workspace.rootSplit);
    this.rootSplit.getContainer = () =>
      containerForDocument(this.document, this.plugin);
    this.containerEl.appendChild(this.rootSplit.containerEl);
    return workspace.createLeafInParent(this.rootSplit, 0);
  }

  onload() {
    this.registerEvent(
      this.plugin.app.workspace.on("layout-change", () => {
        // Top-level items are never tabbed here.
        this.rootSplit.children.forEach((item, index) => {
          if (item instanceof WorkspaceTabs) {
            this.rootSplit.replaceChild(index, item.children[0]);
          }
        });
      }),
    );
  }

  onunload() {
    this.hoverEl.detach();
  }
}
