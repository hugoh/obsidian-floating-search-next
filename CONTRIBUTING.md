# Contributing

Issues and pull requests are welcome. PR titles must follow
[Conventional Commits](https://www.conventionalcommits.org) (`feat: …`,
`fix: …`), which CI checks. PRs are squash-merged, so the title becomes the
commit message and the changelog entry.

## Development

Tooling is managed by [mise](https://mise.jdx.dev) (Bun, hk and the linters):

```sh
mise install
bun install
bun run dev        # rebuild main.js on change
bun run test       # unit tests (bun) and regression tests (node)
bun run test:e2e   # builds, then runs the plugin in a real Obsidian
bun run test:e2e:container # the same, in a Linux container: no window opens on your screen
bun run screenshot # retakes media/screenshot.png for the README
bun run lint       # eslint-plugin-obsidianmd, the rules the plugin review applies
bun run typecheck  # plugin, unit tests and e2e specs
bun run knip       # unused files, exports and dependencies (see knip.json)
bun run build      # typecheck + production bundle
hk check --all     # everything CI runs
```

`test:e2e` downloads Obsidian into `.obsidian-cache/` (gitignored), along with the
Recent Files community plugin that the recent-files specs run against (installed
disabled, pinned by `RECENT_FILES_VERSION` in `test/wdio.conf.mts`; Renovate keeps the
pin current, so a failing recent-files spec after a bump means the plugin changed). It uses
[wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service).
By default it tests the latest release; CI also runs Obsidian 1.15.1, the
oldest stable version at or above our minimum. Set `OBSIDIAN_VERSIONS` (for
example `"1.15.1/earliest latest/latest"`) to test others.

`test:e2e` opens a real Obsidian window and takes focus, so typing elsewhere while it runs
breaks the specs that wait for focus. `test:e2e:container` runs the same suite under a
virtual display (as CI does) in Apple's `container` CLI, Docker or Podman, whichever is
installed first, so it can run while you work. It builds `test/container/Containerfile`,
copies the project in, installs dependencies for Linux and keeps its own downloads in
`.obsidian-cache/container/`. Arguments go to wdio, for example
`bun run test:e2e:container -- --spec ./test/specs/settings.e2e.ts`.

## Releasing

Obsidian requires the release tag to equal `manifest.json`'s `version` (with no
`v` prefix), and it reads that version from the default branch. Releases are
driven by [release-please](https://github.com/googleapis/release-please) from
Conventional Commits: it keeps a release PR that bumps `manifest.json` and
`package.json`. Merging it tags the release and opens a draft. The `publish`
job in `.github/workflows/ci.yml` then builds with a frozen lockfile, runs the
tests and lint, attests `main.js`, `manifest.json` and `styles.css`, attaches
all three, and only then publishes the draft, so Obsidian never sees a version
without assets.

The workflow needs a GitHub App (so the release PR triggers CI): set the
repository variable `RELEASE_APP_CLIENT_ID` and the secret
`RELEASE_APP_PRIVATE_KEY`.
