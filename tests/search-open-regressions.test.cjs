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

test('the preview always opens in reading mode, first open and reuse alike', async () => {
  const h = createHarness();
  const modal = new h.SearchOpenModal(() => {}, h.plugin, { query: 'needle' });
  modal.searchLeaf = h.makeLeaf();
  await modal.initFileView(new h.TFile('first.md'), undefined);
  await modal.initFileView(new h.TFile('second.md'), undefined);
  const { opened } = h.spawned[0].leaf;
  assert.equal(opened.length, 2);
  for (const { options } of opened) assert.equal(options.state.mode, 'preview');
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

test('a preview that fails to open says so and leaves no empty pane behind', async () => {
  const h = createHarness();
  const leaf = h.makeLeaf();
  leaf.openFile = () => Promise.reject(new Error('boom'));
  h.leafModule.nextLeaf = leaf;
  const modal = new h.SearchOpenModal(() => {}, h.plugin, { query: 'needle' });
  modal.searchLeaf = h.makeLeaf();
  modal.searchEmbeddedView = { unload() {} };
  await modal.initFileView(new h.TFile('broken.md'), undefined);
  assert.equal(h.notices.length, 1, 'the user is told');
  assert.equal(h.consoleErrors.length, 1, 'and the cause is logged');
  assert.equal(modal.fileLeaf, undefined);
  assert.equal(leaf.detached, true);
  assert.deepEqual(h.clock.errors, []);
});

test('a modal that cannot build its search view says so and closes', async () => {
  const h = createHarness();
  const leaf = h.makeLeaf();
  leaf.setViewState = () => Promise.reject(new Error('boom'));
  h.leafModule.nextLeaf = leaf;
  const modal = new h.SearchOpenModal(() => {}, h.plugin, { query: 'needle' });
  await modal.open();
  assert.equal(h.notices.length, 1);
  assert.equal(h.consoleErrors.length, 1);
  assert.equal(modal.isOpen, false, 'a half-built modal is not left on screen');
});

test('typing before the state settles leaves the caret where the typing put it', async () => {
  const h = createHarness();
  const leaf = h.makeLeaf();
  const selections = [];
  leaf.view.searchComponent = { inputEl: { value: 'pin', setSelectionRange: (...range) => selections.push(range) } };
  h.leafModule.nextLeaf = leaf;
  const modal = new h.SearchOpenModal(() => {}, h.plugin, { query: '' });
  await modal.initSearchView(new ElementStub());
  await h.clock.tick(0);
  assert.deepEqual(selections, []);
});

test('the query is still selected when nothing was typed meanwhile', async () => {
  const h = createHarness();
  const leaf = h.makeLeaf();
  const selections = [];
  leaf.view.searchComponent = { inputEl: { value: '', setSelectionRange: (...range) => selections.push(range) } };
  h.leafModule.nextLeaf = leaf;
  const modal = new h.SearchOpenModal(() => {}, h.plugin, { query: 'needle' });
  await modal.initSearchView(new ElementStub());
  await h.clock.tick(0);
  assert.deepEqual(selections, [[0, 6]]);
});

test('closing before the search view took its state reports no state to save', async () => {
  const h = createHarness();
  const results = [];
  const modal = new h.SearchOpenModal((closing) => results.push(closing), h.plugin, { query: 'needle' });
  modal.searchLeaf = h.makeLeaf();
  modal.onClose();
  assert.deepEqual(results, [undefined]);

  const settled = [];
  const later = new h.SearchOpenModal((closing) => settled.push(closing), h.plugin, { query: 'needle' });
  h.leafModule.nextLeaf = h.makeLeaf();
  await later.initSearchView(new ElementStub());
  later.onClose();
  assert.equal(settled.length, 1);
  assert.equal(settled[0].state.query, 'needle');
});

function canvasPreview(h, { showing }) {
  const selected = [];
  const nodes = [{ id: 'a', text: 'first' }, { id: 'b', text: 'second' }];
  const canvas = {
    data: { nodes },
    nodes: new Map(nodes.map((node) => [node.id, node])),
    selectOnly: (node) => selected.push(node.text),
    zoomToSelection: () => selected.push('zoomed'),
  };
  const file = new h.TFile('board.canvas');
  const leaf = h.makeLeaf();
  const loaded = deferred();
  leaf.openFile = () => loaded.promise.then(() => { leaf.view = { ...leaf.view, canvas, file: showing(file) }; });
  h.leafModule.nextLeaf = leaf;
  const modal = new h.SearchOpenModal(() => {}, h.plugin, { query: 'needle' });
  modal.searchLeaf = h.makeLeaf();
  return { modal, file, selected, loaded };
}

test('the matching canvas card is selected once the canvas has loaded, however long that takes', async () => {
  const h = createHarness();
  const { modal, file, selected, loaded } = canvasPreview(h, { showing: (f) => f });
  const preview = modal.initFileView(file, { match: { content: 'second', matches: [] } });
  await h.clock.tick(500);
  assert.deepEqual(selected, [], 'nothing can be selected before the canvas exists');
  loaded.resolve();
  await preview;
  assert.deepEqual(selected, ['second', 'zoomed']);
});

test('a canvas leaf still showing another file gets no card selected', async () => {
  const h = createHarness();
  const { modal, file, selected, loaded } = canvasPreview(h, { showing: () => new h.TFile('other.canvas') });
  const preview = modal.initFileView(file, { match: { content: 'first', matches: [] } });
  loaded.resolve();
  await preview;
  assert.deepEqual(selected, []);
});

async function openedModal(h) {
  h.leafModule.nextLeaf = h.makeLeaf();
  const modal = new h.SearchOpenModal(() => {}, h.plugin, { query: 'needle' });
  await modal.open();
  return modal;
}

test('dragging a result out of the modal closes it, once the drag has started', async () => {
  const h = createHarness();
  const modal = await openedModal(h);
  modal.searchCtnEl.dispatchEvent({ type: 'dragstart', target: { closest: (selector) => (selector === '.tree-item' ? {} : null) } });
  assert.equal(modal.isOpen, true, 'closing at once would cancel the drag');
  await h.clock.tick(20);
  assert.equal(modal.isOpen, false);
});

test('dragging something that is not a result leaves the modal open', async () => {
  const h = createHarness();
  const modal = await openedModal(h);
  modal.searchCtnEl.dispatchEvent({ type: 'dragstart', target: { closest: () => null } });
  await h.clock.tick(20);
  assert.equal(modal.isOpen, true);
});

test('a drag that outlives its modal does not close the next one', async () => {
  const h = createHarness();
  const first = await openedModal(h);
  first.searchCtnEl.dispatchEvent({ type: 'dragstart', target: { closest: () => ({}) } });
  first.close();
  const second = await openedModal(h);
  await h.clock.tick(20);
  assert.equal(second.isOpen, true);
});
