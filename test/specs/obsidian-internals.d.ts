import "obsidian";

/** The slice of the plugin that the e2e specs drive. */
export interface TestPlugin {
  settings: Record<string, unknown> & {
    searchViewState: { sortOrder?: string };
  };
  state: Record<string, unknown>;
  initModal(state: Record<string, unknown>, caret?: unknown): void;
  modal: {
    cb: (...args: unknown[]) => void;
    close(): void;
    fileLeaf?: { view: { file?: { path: string } } };
    searchLeaf: {
      view: {
        setSortOrder(order: string): void;
        getState(): { sortOrder?: string };
        dom: {
          focusedItem?: { file?: { path: string } } | null;
          resultDomLookup: Map<{ path: string }, { el: HTMLElement }>;
        };
      };
    };
  };
  applySettingsUpdate(): void;
  loadData(): Promise<Record<string, unknown> | null>;
  saveData(data: unknown): Promise<void>;
}

declare module "obsidian" {
  interface App {
    plugins: {
      plugins: Record<string, TestPlugin>;
      enablePlugin(id: string): Promise<void>;
      disablePlugin(id: string): Promise<void>;
    };
    commands: { commands: Record<string, unknown> };
  }

  interface Workspace {
    protocolHandler: {
      handlers: Map<string, (params: Record<string, string>) => void>;
    };
  }
}
