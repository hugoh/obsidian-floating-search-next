import type { TFile, WorkspaceLeaf } from "obsidian";

interface CanvasNode {
  id: string;
  text?: string;
}

/** The slice of a Canvas view used to select the matched card in a preview. */
interface CanvasLeafView {
  file?: TFile;
  canvas?: {
    data: { nodes?: CanvasNode[] };
    nodes: Map<string, CanvasNode>;
    selectOnly(node: CanvasNode): void;
    zoomToSelection(): void;
  };
}

/**
 * Selects and zooms to the canvas card whose text a search result matched,
 * once the leaf shows that canvas.
 */
export function selectMatchedCard(
  leaf: WorkspaceLeaf,
  file: TFile,
  matchedText: string | undefined,
) {
  const view = leaf.view as CanvasLeafView;
  if (matchedText === undefined || view.file !== file || !view.canvas) return;
  const { canvas } = view;
  const found = canvas.data.nodes?.find((node) => node.text === matchedText);
  const card = found && canvas.nodes.get(found.id);
  if (!card) return;
  canvas.selectOnly(card);
  canvas.zoomToSelection();
}
