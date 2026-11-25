# Search & Open regression tests

Run after installing the repository's dependencies:

```sh
node --test tests/*.test.cjs
```

These tests transpile the actual TypeScript source with the existing esbuild
dependency and run it in a `vm` context. `monkey-around` is the real installed
dependency. Obsidian classes, DOM elements and timers are small isolated test
doubles (`harness.cjs`), so no Obsidian app, vault or desktop is modified.

- `search-open-regressions.test.cjs` covers the modal's lifecycle: closing
  during initialisation or a preview read leaves no late focus or state writes,
  an empty selection clears the preview, the delayed state re-apply never
  overwrites text the user already typed, and unloading closes the modal before
  saving.
- `embedded-leaf.test.cjs` runs the real `leafView.ts` (the split, its root and
  container, un-tabbing and unload) and the real patches in `main.ts`
  (`getLeaf`, undo history, pinning, the drag handler, and unloading restoring
  Obsidian's own methods).
- `scorecard.test.cjs` checks repository facts the plugin review looks at.

Timers and deferred promises make the cancellation tests deterministic. These
are behavioural tests against stand-ins, not a replacement for testing the
rendered UI in a real Obsidian (see `test:e2e`).

To run the same assertions against another source snapshot, set
`SEARCH_OPEN_TEST_SOURCE_ROOT` to a directory containing
`src/main.ts` and `src/nativeModal.ts`. Dependencies still resolve from
this repository.
