# Search & Open regression tests

Run after installing the repository's dependencies:

```sh
node --test tests/*.test.cjs
```

These tests transpile the actual TypeScript source with the existing esbuild
dependency. The test loader adds an export for the private modal class only
in memory; it does not change the plugin's production exports. `monkey-around`
is the real installed dependency. Obsidian classes, DOM elements and timers are
small isolated test doubles, so no Obsidian app, vault or desktop is modified.

Coverage is the native modal's lifecycle: closing during initialisation or a preview read must not leave late focus or state writes, an empty selection clears the preview, and the delayed state re-apply never overwrites text the user already typed. Timers and deferred promises make the cancellation tests deterministic. These are behavioral unit tests, not a replacement for testing rendered UI in a real application (see `test:e2e`).

To run the same assertions against another source snapshot, set
`SEARCH_OPEN_TEST_SOURCE_ROOT` to a directory containing
`src/main.ts` and `src/nativeModal.ts`. Dependencies still resolve from
this repository.
