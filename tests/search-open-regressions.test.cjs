const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, deferred, ElementStub } = require('./harness.cjs');

test('closing the native modal while its search leaf initializes stops post-await setup', async () => {
  const h = createHarness();
  const pending = deferred();
  const leaf = h.makeLeaf();
  leaf.setViewState = () => pending.promise;
  let stateWrites = 0;
  leaf.view.setState = async () => { stateWrites++; };
  h.leafModule.nextLeaf = leaf;
  const modal = new h.SearchOpenModal(() => {}, h.plugin, { query: 'needle' });
  const continued = [];
  for (const name of ['initInput', 'initContent']) {
    modal[name] = () => continued.push(name);
  }
  const opening = modal.onOpen();
  modal.onClose();
  pending.resolve();
  await opening;
  await h.clock.tick(100);
  assert.deepEqual(continued, [], 'Closing before init resolves must not install listeners or focus');
  assert.equal(stateWrites, 0, 'Detached search leaf must not receive delayed state writes');
  assert.equal(leaf.view.searchComponent.inputEl.selectionCount || 0, 0);
  assert.deepEqual(h.clock.errors, []);
});

test('closing the native modal during a preview read prevents late focus', async () => {
  const h = createHarness();
  const pending = deferred();
  const leaf = h.makeLeaf();
  let readStarted = false;
  leaf.openFile = () => { readStarted = true; return pending.promise; };
  h.leafModule.nextLeaf = leaf;
  const modal = new h.SearchOpenModal(() => {}, h.plugin, { query: 'needle' });
  modal.searchLeaf = h.makeLeaf();
  modal.searchEmbeddedView = { unload() {} };
  const input = modal.searchLeaf.view.searchComponent.inputEl;
  const preview = modal.initFileView(new h.TFile('slow.md'), undefined);
  await h.clock.microtasks();
  assert.equal(readStarted, true, 'Exercise close while native preview openFile is pending');
  modal.onClose();
  pending.resolve();
  await preview;
  await h.clock.tick(100);
  assert.equal(input.focusCount, 0, 'Native preview completion must not focus the closed search input');
  assert.deepEqual(h.clock.errors, []);
});

test('native search clears its preview when no result is focused', async () => {
  const h = createHarness();
  const modal = new h.SearchOpenModal(() => {}, h.plugin, { query: 'needle' });
  modal.searchLeaf = h.makeLeaf();
  modal.searchLeaf.view.dom = { focusedItem: undefined };
  await modal.initFileView(new h.TFile('previous.md'), undefined);
  const preview = h.spawned[0];
  modal.autoPreviewFocusedItem();
  assert.equal(preview.leaf.detached, true);
  assert.equal(preview.embedded.unloaded, true);
  assert.equal(modal.modalEl.hasClass('search-open-width'), false);
  assert.equal(modal.fileLeaf, undefined);
});

test('native initialization cannot change selection after closing during delayed setState', async () => {
  const h = createHarness();
  const pending = deferred();
  const leaf = h.makeLeaf();
  let setStateStarted = false;
  leaf.view.setState = () => { setStateStarted = true; return pending.promise; };
  h.leafModule.nextLeaf = leaf;
  const modal = new h.SearchOpenModal(() => {}, h.plugin, { query: 'needle' });
  await modal.initSearchView(new ElementStub());
  await h.clock.tick(0);
  assert.equal(setStateStarted, true);
  modal.onClose();
  pending.resolve();
  await h.clock.microtasks();
  assert.equal(leaf.view.searchComponent.inputEl.selectionCount || 0, 0);
  assert.deepEqual(h.clock.errors, []);
});

test('the undo-history patch only skips embedded search leaves', () => {
  const h = createHarness();
  const { Workspace } = h.obsidian;
  Workspace.prototype.pushUndoHistory = () => 'recorded';
  const uninstallers = [];
  h.default.prototype.patchWorkspace.call({ app: h.app, register: (fn) => uninstallers.push(fn) });
  h.leafModule.isEmbeddedLeaf = (leaf) => leaf.embedded;
  const leafOf = (embedded) => ({ embedded, getViewState: () => ({ type: 'search' }) });
  const workspace = new Workspace();
  assert.equal(workspace.pushUndoHistory(leafOf(false), 'id'), 'recorded', 'a normal search view keeps its history');
  assert.equal(workspace.pushUndoHistory(leafOf(true), 'id'), undefined, 'the embedded one is skipped');
  uninstallers.forEach((uninstall) => uninstall());
});

test('unloading closes the modal first, then saves and drops the pending timer', () => {
  const h = createHarness();
  const steps = [];
  h.default.prototype.onunload.call({
    modal: { close() { steps.push('close'); } },
    applySettingsUpdate: { run() { steps.push('save'); } },
    forgetQuery: { cancel() { steps.push('cancel'); } },
  });
  assert.deepEqual(steps, ['close', 'save', 'cancel']);
});

test('native initialization does not overwrite text typed before the delayed state is applied', async () => {
  const h = createHarness();
  const leaf = h.makeLeaf();
  const delayed = [];
  leaf.view.setState = async (state) => { delayed.push(state); };
  leaf.view.searchComponent = { inputEl: { value: 'pineapple', setSelectionRange() {} } };
  h.leafModule.nextLeaf = leaf;
  const modal = new h.SearchOpenModal(() => {}, h.plugin, { query: '' });
  await modal.initSearchView(new ElementStub());
  await h.clock.tick(0);
  assert.equal(delayed.length, 0, 'User input must not be replaced by the saved state');
});

test('native initialization still applies the delayed state while the input is untouched', async () => {
  const h = createHarness();
  const leaf = h.makeLeaf();
  const delayed = [];
  leaf.view.setState = async (state) => { delayed.push(state); };
  leaf.view.searchComponent = { inputEl: { value: '', setSelectionRange() {} } };
  h.leafModule.nextLeaf = leaf;
  const modal = new h.SearchOpenModal(() => {}, h.plugin, { query: '' });
  await modal.initSearchView(new ElementStub());
  await h.clock.tick(0);
  assert.equal(delayed.length, 1);
});
