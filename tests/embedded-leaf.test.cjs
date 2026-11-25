const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, ElementStub } = require('./harness.cjs');

function embed(h) {
  const { EmbeddedView, isEmbeddedLeaf } = h.realLeafView();
  const target = new ElementStub();
  target.ownerDocument = {};
  const view = new EmbeddedView(target, { app: h.app });
  return { leaf: view.leaf, view, target, isEmbeddedLeaf };
}

test('the embedded view puts a leaf in its own split inside the target element', () => {
  const h = createHarness();
  const { leaf, view, target } = embed(h);
  assert.equal(leaf.split, view.rootSplit);
  assert.equal(leaf.index, 0);
  assert.equal(target.children[0], view.hoverEl);
  assert.ok(view.hoverEl.hasClass('search-open-embed'));
  assert.ok(view.containerEl.children.includes(view.rootSplit.containerEl));
});

test('the split resolves to the real workspace as its root and container', () => {
  const h = createHarness();
  const { view } = embed(h);
  assert.equal(view.rootSplit.getRoot(), h.app.workspace.rootSplit);
  assert.equal(view.rootSplit.getContainer(), h.app.workspace.rootSplit);
});

test('a tab group inside the split is replaced by its first child on layout change', () => {
  const h = createHarness();
  const { view } = embed(h);
  const inner = { inner: true };
  view.rootSplit.children.push(new h.obsidian.WorkspaceTabs([inner]));
  h.app.workspace.layoutListeners[0].callback();
  assert.deepEqual(view.rootSplit.replaced, [{ index: 0, child: inner }]);
});

test('unloading the embedded view removes its element and its listeners', () => {
  const h = createHarness();
  const { view } = embed(h);
  assert.equal(h.app.workspace.layoutListeners.length, 1);
  view.unload();
  assert.equal(view.hoverEl.detached, true);
  assert.equal(h.app.workspace.layoutListeners.length, 0);
});

test('only leaves inside an embedded view count as embedded', () => {
  const h = createHarness();
  const { isEmbeddedLeaf } = embed(h);
  const leafMatching = (matches) => ({ containerEl: { matches: () => matches } });
  assert.equal(isEmbeddedLeaf(leafMatching(true)), true);
  assert.equal(isEmbeddedLeaf(leafMatching(false)), false);
  assert.equal(isEmbeddedLeaf(undefined), false);
});

function patchedWorkspace(h) {
  const { Workspace } = h.obsidian;
  const originals = {
    getLeaf: function (...args) { return { opened: args }; },
    pushUndoHistory: () => 'recorded',
  };
  Object.assign(Workspace.prototype, originals);
  const uninstall = h.default.prototype.patchWorkspace.call({ app: h.app });
  h.leafModule.isEmbeddedLeaf = (leaf) => Boolean(leaf?.embedded);
  return { Workspace, originals, uninstall };
}

test('getLeaf keeps a link opened inside the embedded preview in that preview', () => {
  const h = createHarness();
  const { Workspace, uninstall } = patchedWorkspace(h);
  const workspace = new Workspace();
  const redirected = [];
  workspace.setActiveLeaf = (leaf) => redirected.push(leaf);
  const activeIn = (embedded, type) => {
    const leaf = { embedded, view: { getViewType: () => type } };
    h.app.workspace.activeView = { leaf };
    return leaf;
  };

  const markdown = activeIn(true, 'markdown');
  assert.equal(workspace.getLeaf('tab'), markdown, 'the previewed note is reused');

  activeIn(true, 'canvas');
  assert.deepEqual(workspace.getLeaf('tab'), { opened: ['tab'] }, 'anything else falls through to Obsidian');
  assert.deepEqual(redirected, [{ mostRecent: true }], 'after making the main workspace active');

  redirected.length = 0;
  activeIn(false, 'markdown');
  assert.deepEqual(workspace.getLeaf('tab'), { opened: ['tab'] });
  assert.deepEqual(redirected, [], 'a normal leaf is left alone');
  uninstall();
});

test('unloading the plugin puts Obsidian\'s own workspace methods back', () => {
  const h = createHarness();
  const { Workspace, originals, uninstall } = patchedWorkspace(h);
  assert.notEqual(Workspace.prototype.getLeaf, originals.getLeaf);
  assert.notEqual(Workspace.prototype.pushUndoHistory, originals.pushUndoHistory);
  uninstall();
  assert.equal(Workspace.prototype.getLeaf, originals.getLeaf);
  assert.equal(Workspace.prototype.pushUndoHistory, originals.pushUndoHistory);
  assert.equal(Object.hasOwn(Workspace.prototype, 'setActiveLeaf'), false);
});

test('an embedded leaf stays pinned, a normal one does not', () => {
  const h = createHarness();
  const { WorkspaceLeaf } = h.obsidian;
  WorkspaceLeaf.prototype.setPinned = function (pinned) { this.pinned = pinned; };
  const uninstall = h.default.prototype.patchWorkspaceLeaf.call({ app: h.app });
  h.leafModule.isEmbeddedLeaf = (leaf) => leaf.embedded;
  const leafOf = (embedded) => Object.assign(Object.create(WorkspaceLeaf.prototype), { embedded });
  const embedded = leafOf(true);
  embedded.setPinned(false);
  assert.equal(embedded.pinned, true);
  const normal = leafOf(false);
  normal.setPinned(false);
  assert.equal(normal.pinned, false);
  uninstall();
});

test('the tracker patch skips a file that was only shown by an embedded leaf', () => {
  const h = createHarness();
  const collected = [];
  const tracker = { onFileOpen(_next, previous) { if (previous) collected.push(previous); } };
  const original = tracker.onFileOpen;
  h.app.workspace.recentFileTracker = tracker;
  const uninstall = h.default.prototype.patchRecentFileTracker.call({ app: h.app });
  h.leafModule.isEmbeddedLeaf = (leaf) => leaf.embedded;
  const activate = (embedded) => { h.app.workspace.activeView = { leaf: { embedded } }; };
  const note = { path: 'note.md' };
  const previewed = { path: 'previewed.md' };
  const opened = { path: 'opened.md' };

  activate(true);
  tracker.onFileOpen(previewed, note);
  tracker.onFileOpen(null, previewed);
  assert.deepEqual(collected, [note], 'the note left behind counts, the preview does not');

  activate(false);
  tracker.onFileOpen(opened, null);
  tracker.onFileOpen(note, opened);
  assert.deepEqual(collected, [note, opened], 'a file opened for real is recorded when replaced');

  uninstall();
  assert.equal(tracker.onFileOpen, original, 'unloading restores the tracker');
});

test('the Recent Files plugin ignores previewed files only while the modal is open', () => {
  const h = createHarness();
  const plugin = { shouldAddFile: () => true };
  const self = { app: { plugins: { plugins: { 'recent-files-obsidian': plugin } } }, register() {} };
  const modal = { hasPreviewed: (file) => file.path === 'previewed.md' };
  const release = h.default.prototype.holdBackRecentFiles.call(self, modal);
  assert.equal(plugin.shouldAddFile({ path: 'previewed.md' }), false);
  assert.equal(plugin.shouldAddFile({ path: 'other.md' }), true);
  release();
  assert.equal(plugin.shouldAddFile({ path: 'previewed.md' }), true);
});

test('holding back the Recent Files plugin does nothing when it is not installed', () => {
  const h = createHarness();
  const self = { app: { plugins: { plugins: {} } }, register() {} };
  const release = h.default.prototype.holdBackRecentFiles.call(self, { hasPreviewed: () => true });
  assert.doesNotThrow(release);
});

test('the leaf patch leaves openFile alone', () => {
  const h = createHarness();
  const { WorkspaceLeaf } = h.obsidian;
  const original = function () { return Promise.resolve(); };
  WorkspaceLeaf.prototype.openFile = original;
  const uninstall = h.default.prototype.patchWorkspaceLeaf.call({ app: h.app });
  assert.equal(WorkspaceLeaf.prototype.openFile, original);
  uninstall();
});
