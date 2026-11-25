const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, ElementStub } = require('./harness.cjs');

function embed(h) {
  const { spawnLeafView, isEmbeddedLeaf } = h.realLeafView();
  const target = new ElementStub();
  target.ownerDocument = {};
  const [leaf, view] = spawnLeafView({ app: h.app }, target);
  return { leaf, view, target, isEmbeddedLeaf };
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
  const uninstallers = [];
  h.default.prototype.patchWorkspace.call({ app: h.app, register: (fn) => uninstallers.push(fn) });
  h.leafModule.isEmbeddedLeaf = (leaf) => Boolean(leaf?.embedded);
  return { Workspace, originals, uninstall: () => uninstallers.forEach((fn) => fn()) };
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
  const uninstallers = [];
  h.default.prototype.patchWorkspaceLeaf.call({ app: h.app, register: (fn) => uninstallers.push(fn) });
  h.leafModule.isEmbeddedLeaf = (leaf) => leaf.embedded;
  const leafOf = (embedded) => Object.assign(Object.create(WorkspaceLeaf.prototype), { embedded });
  const embedded = leafOf(true);
  embedded.setPinned(false);
  assert.equal(embedded.pinned, true);
  const normal = leafOf(false);
  normal.setPinned(false);
  assert.equal(normal.pinned, false);
  uninstallers.forEach((fn) => fn());
});

test('dragging a file closes the modal that was open, not one opened a moment later', async () => {
  const h = createHarness();
  const manager = Object.create({ dragFile() { return 'dragged'; } });
  const closed = [];
  const first = { close() { closed.push('first'); } };
  const second = { close() { closed.push('second'); } };
  const uninstallers = [];
  const plugin = { app: { dragManager: manager }, modal: first, register: (fn) => uninstallers.push(fn) };
  h.default.prototype.patchDragManager.call(plugin);
  assert.equal(manager.dragFile({}, {}), 'dragged');
  plugin.modal = second;
  await h.clock.tick(20);
  assert.deepEqual(closed, ['first']);
  uninstallers.forEach((fn) => fn());
});

test('a failed patch run is retried on the next open instead of being marked done', () => {
  const h = createHarness();
  let attempts = 0;
  const plugin = {
    patched: false,
    patchWorkspace() { attempts++; throw new Error('boom'); },
    patchWorkspaceLeaf() {},
    patchDragManager() {},
    patchEditorHighlights() {},
  };
  assert.throws(() => h.default.prototype.ensurePatched.call(plugin), /boom/);
  assert.throws(() => h.default.prototype.ensurePatched.call(plugin), /boom/);
  assert.equal(attempts, 2);
});
