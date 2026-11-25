import "obsidian";
import type { TFile } from "obsidian";

declare module "obsidian" {
  interface App {
    plugins: {
      plugins: Record<string, Plugin | undefined> & {
        ["recent-files-obsidian"]?: Plugin & {
          shouldAddFile(file: TFile): boolean;
        };
      };
    };
    dragManager?: DragManager;
  }

  interface DragManager {
    dragFile(event: DragEvent, file: TFile): unknown;
  }

  interface SearchResultItem {
    el: HTMLElement;
    containerEl: HTMLElement;
    file?: TFile;
    parent: { file?: TFile };
    content?: string;
    matches?: unknown[];
    collapsible?: boolean;
    collapseEl?: HTMLElement;
    setCollapse(collapse: boolean): void;
  }

  interface SearchResultDom {
    focusedItem: SearchResultItem | null;
    setFocusedItem(item: SearchResultItem | null | undefined): void;
    resultDomLookup: Map<TFile, SearchResultItem>;
  }

  interface SearchView extends View {
    onKeyArrowRightInFocus(e: KeyboardEvent): void;
    onKeyArrowLeftInFocus(e: KeyboardEvent): void;
    onKeyArrowUpInFocus(e: KeyboardEvent): void;
    onKeyArrowDownInFocus(e: KeyboardEvent): void;
    onKeyEnterInFocus(e: KeyboardEvent): void;
    onKeyShowMoreBefore(e: KeyboardEvent): void;
    onKeyShowMoreAfter(e: KeyboardEvent): void;
    dom: SearchResultDom;
    searchComponent: SearchComponent;
  }

  interface WorkspaceParent {
    replaceChild(index: number, child: WorkspaceItem, resize?: boolean): void;
    containerEl: HTMLElement;
    children: WorkspaceItem[];
  }

  interface WorkspaceLeaf {
    containerEl: HTMLDivElement;
    activeTime: number;
  }

  interface Editor {
    removeHighlights?(...args: unknown[]): void;
    hasHighlight?(...args: unknown[]): boolean;
  }

  interface Workspace {
    recentFileTracker?: {
      onFileOpen(newFile: TFile | null, oldFile: TFile | null): void;
    };
    pushUndoHistory(leaf: WorkspaceLeaf, id: string, e: unknown): void;
    floatingSplit: (WorkspaceSplit & { children: WorkspaceContainer[] }) | null;
  }
}
