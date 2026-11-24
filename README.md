# Pane Search

> **Work in progress.** This project was first positioned as a successor to Floating Search. We are rethinking that framing, so its scope, features and name may change. For now, it is not available in the Obsidian Community plugin store.

Open Obsidian's global search in a floating modal with a preview pane.

## About this plugin

Pane Search is a fork of [Floating Search](https://github.com/Quorafind/Obsidian-Float-Search) by Boninall. It also consolidates two other forks of it, [Float Search Window](https://github.com/AiurArtanis/Obsidian-Float-Search-Window) by AiurArtanis and [Obsidian Float Search](https://github.com/Peingxious/Obsidian-Float-Search) by Peingxious, each of which fixed and added different things. The initial goal was to bring them together into one cleaned-up codebase: harvest what is useful from each, reconcile the overlaps, add tests, and fix the lint backlog.

See [Credits and licensing](#credits-and-licensing) for the full lineage and [docs/consolidation.md](docs/consolidation.md) for where each feature came from and every fix made while merging.

Yes, we are aware of [xkcd 927](https://xkcd.com/927/): this is, technically, *yet another fork*, created to standardize all the forks. PRs welcome.

## Installation

Until the plugin is available in the Community plugin store, install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install and enable **BRAT** from **Settings → Community plugins**.
2. Open the command palette and run **BRAT: Add a beta plugin for testing**.
3. Enter `hugoh/obsidian-pane-search` and confirm.
4. Enable **Pane Search** under **Settings → Community plugins**.

BRAT also keeps the plugin up to date.

## Coming from Floating Search?

Both **Floating Search** and this plugin change the same parts of Obsidian and answer `obsidian://fs` links, so avoid running them together.

Settings are stored per plugin, so nothing carries over automatically. Commands have new ids, so rebind any hotkeys under **Settings → Hotkeys** (search for "Pane Search").

This plugin is much smaller than Floating Search: it only has the global search modal. The quick search (double-Shift), saved searches, hidden folders, filter bar, split/tab/window views and the operator and current-file commands are not included.

![float-search.png](media/img.png)

- Set hotkey for open pane search quickly.

## 使用说明 | Usage

1. **Two commands**:
    - `Search Obsidian Globally`: Searches all global content, and the characters entered will be cleared automatically after each search;
    - `Search Obsidian Globally (With Last State)`: Searches all global content, and the characters entered will be cleared 30 seconds after each search;
2. **When the cursor is focused on the search input box**:
    - Use the up and down arrow keys to switch between search results;
    - When a search result is selected, hold the Shift key and press the up or down arrow keys to expand the results upwards or downwards; when focused on a file name, you can collapse the search results under the current file name;
    - When a search result is selected,
        - Press Enter to open the file in the background;
        - Press Alt+Enter to open the file and close the popup;
        - Press Ctrl+Shift+Alt+Enter to open the file in a new window and close the popup;
    - When a search result is selected, press Tab to preview the corresponding file in the current popup's right side, and Shift+Tab to close the preview;
    - When a search result is focused, press Ctrl+Shift+C to copy the selected search result content;
    - When a file is being previewed, press Ctrl+E to toggle the file's reading mode;
    - When a file is being previewed, press Ctrl+G to jump from the input box to the content of the previewed file, or from the previewed file content back to the input box;
    - When a file is being previewed, press Tab twice to jump into the content of the previewed file, or use Ctrl+Tab to switch back to the input box from the previewed file.
3. **Mouse click behavior**:
    - When a file is being previewed:
        - Clicking a new search result with the mouse will not automatically close the popup, but instead switch the file in the preview window;
        - Use Alt+mouse click to open the file and close the popup;
    - When no file is being previewed:
        - Clicking a search result with the mouse will automatically close the popup and navigate to the file, and other behavior is the same as Obsidian's default behavior;
4. **The right-click context menu can quickly search the selected text**;
5. **There is a default `obsidian://fs?query=xxxxxx` URI command, which you can use to invoke Pane Search from external sources**;
6. **When you click to navigate within the previewed file page, the current previewed file page will be automatically replaced**.

---

1. **两个命令**：
    - `Search Obsidian Globally`：用于搜索全局的所有内容，每次搜索后的字符都会自动清空；
    - `Search Obsidian Globally (With Last State)`：用于搜索全局的所有内容，每次搜索后的字符都会在三十秒后清空；
2. **当光标聚焦在搜索输入框的时候**：
    - 按上下方向键来切换选择结果；
    - 当有一个搜索结果被选择时，按住 Shift 键再按上下方向键来向上展开或者向下展开结果；当聚焦在文件名上的时候，可以折叠当前文件名下的搜索结果；
    - 当有一个搜索结果被选择时，
        - 按 Enter 来在背景中打开文件；
        - 按 Alt+Enter 则是打开该文件且关闭弹窗；
        - 按 Ctrl+Shift+Alt+Enter 则是用新窗口打开该文件，且关闭弹窗；
    - 当有一个搜索结果被选择时，按 Tab 来在当前弹窗的右侧预览对应的文件，Shift+Tab 则是关闭预览；
    - 当有一个搜索结果被聚焦时，按 Ctrl+Shift+C 来复制选中的搜索结果内容；
    - 当有一个文件正在被预览时，按 Ctrl+E 来切换文件的阅读模式；
    - 当有一个文件正在被预览时，按 Ctrl+G 来从输入框跳转到预览文件的内容中，或从预览文件内容中跳转回输入框；
    - 当有一个文件正在被预览时，按两次 Tab 来跳转到预览文件的内容中，或用 Ctrl+Tab 从预览文件中跳转回输入框；
3. **鼠标点击的行为**：
    - 当存在文件在预览中时：
        - 用鼠标点击新的搜索结果不会再自动关闭弹窗，而是在切换预览文件窗口的文件；
        - 用 Alt+鼠标来打开文件且关闭弹窗；
    - 当不存在文件在预览中时：
        - 用鼠标点击搜索结果自动关闭弹窗且跳转文件夹，其它与 Obsidian 的默认行为一样；
4. **右键菜单可以快速搜索选中的文本**；
5. **有一个默认的 `obsidian://fs?query=xxxxxx` 的 URI 命令，你可以用这个命令来从外部唤起 Pane Search**
6. **当你在预览文件页面中点击跳转时，会自动覆盖当前的预览文件页面**。

---

## Settings

- **Show file path** and **Show instructions** (also in the search panel's options inside the modal).
- Obsidian's own sort order, collapse, extra context, explain and match-case toggles are remembered between sessions. The query itself is never saved.

Requires Obsidian 1.13 or later.

## Development

```sh
bun install
bun run build        # type-check and bundle to main.js
bun run lint         # eslint-plugin-obsidianmd
bun run test         # unit tests (bun) + regression tests (node)
bun run test:e2e     # runs the plugin in a real Obsidian (wdio-obsidian-service)
```

## Credits and licensing

Where each feature came from, and every fix made while merging, is recorded in [docs/consolidation.md](docs/consolidation.md).

This project is licensed under the **GNU General Public License v3.0** (see [LICENSE](LICENSE)). All the forks it draws on were checked and are GPL-3.0, so their code can be combined here.

| Source | Contribution | License |
|---|---|---|
| [Quorafind/Obsidian-Float-Search](https://github.com/Quorafind/Obsidian-Float-Search) (Boninall) | The original plugin | GPL-3.0 |
| [AiurArtanis/Obsidian-Float-Search-Window](https://github.com/AiurArtanis/Obsidian-Float-Search-Window) | i18n, preview and file-opening fixes, regression tests | GPL-3.0 |
| [Peingxious/Obsidian-Float-Search](https://github.com/Peingxious/Obsidian-Float-Search) | Stability fixes | GPL-3.0 |
| [nothingislost/obsidian-hover-editor](https://github.com/nothingislost/obsidian-hover-editor) | Embedded leaf implementation (`src/leafView.ts`) | MIT |
| [pjeby/monkey-around](https://github.com/pjeby/monkey-around) | Method patching (bundled dependency) | ISC |

[smilingpoplar/Obsidian-Float-Search](https://github.com/smilingpoplar/Obsidian-Float-Search) (GPL-3.0) was reviewed; its changes are covered by the code above or were not taken. See [NOTICE](NOTICE) for the full third-party notices.
