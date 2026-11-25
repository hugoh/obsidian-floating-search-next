import * as path from "node:path";
import { env } from "node:process";
import { parseObsidianVersions } from "wdio-obsidian-service";

const cacheDir = path.resolve(".obsidian-cache");

// The Recent Files community plugin that the e2e tests install (disabled), to check
// that previewed files stay out of its list. Renovate keeps the version current.
const RECENT_FILES_VERSION = "1.7.10";

// `bun run screenshot` runs the README screenshot spec in its own vault instead of the tests.
const screenshots = Boolean(env.SCREENSHOTS);

// "appVersion/installerVersion" pairs, space separated; override to widen the matrix.
const versions = await parseObsidianVersions(
	env.OBSIDIAN_VERSIONS ?? "latest/latest",
	{ cacheDir },
);

if (env.CI) {
	// Used as the CI cache key for the downloaded Obsidian builds.
	console.log("obsidian-cache-key:", JSON.stringify(versions));
}

export const config: WebdriverIO.Config = {
	runner: "local",
	framework: "mocha",
	specs: screenshots ? ["./screenshots/*.ts"] : ["./specs/**/*.e2e.ts"],
	maxInstances: Number(env.WDIO_MAX_INSTANCES ?? 1),
	capabilities: versions.map<WebdriverIO.Capabilities>(
		([appVersion, installerVersion]) => ({
			browserName: "obsidian",
			"wdio:obsidianOptions": {
				appVersion,
				installerVersion,
				plugins: [
					path.resolve("."),
					{
						id: "recent-files-obsidian",
						version: RECENT_FILES_VERSION,
						enabled: false,
					},
				],
				vault: path.resolve(
					screenshots ? "test/vaults/screenshots" : "test/vaults/simple",
				),
			},
		}),
	),
	services: ["obsidian"],
	reporters: ["obsidian"],
	mochaOpts: { ui: "bdd", timeout: 60_000 },
	waitforInterval: 250,
	waitforTimeout: 10_000,
	logLevel: "warn",
	cacheDir,
	injectGlobals: false,
};
