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
bun run screenshot # retakes media/screenshot.png for the README
bun run lint       # eslint-plugin-obsidianmd, the rules the plugin review applies
bun run typecheck  # plugin, unit tests and e2e specs
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

## Adding a language

Plugin text lives in `src/i18n.ts`, in one typed object per language. English
(`EN`) and Simplified Chinese (`ZH`) exist today; Traditional Chinese
(`zh-TW`, `zh-HK`) currently falls back to English.

1. Copy the `EN` block, rename it (for example `JA`) and translate every message.
2. Add the language to the `Locale` type and to `TRANSLATIONS`, and teach
   `resolveLocale` its Obsidian language code (`ja`, `fr`, ...). Obsidian reports
   Simplified Chinese as `zh` and Traditional as `zh-TW`.
3. Run `bun run test`. TypeScript refuses a language with a missing message, and
   `src/i18n.test.ts` checks the language is complete and has no empty strings.

Please translate by hand or have a native speaker review the result: a missing
translation falls back to English, which is better than a wrong one. Mention
the language in the pull request so the README can list it.

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
