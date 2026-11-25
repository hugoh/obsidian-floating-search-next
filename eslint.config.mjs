import obsidianmd from "eslint-plugin-obsidianmd";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";

export default defineConfig(
	globalIgnores([
    "tests",
		"node_modules",
		".obsidian-cache",
		"main.js",
		"eslint.config.mjs",
		"esbuild.config.mjs",
		"scripts",
		"version-bump.mjs",
		"package.json",
		"tsconfig.json",
		"versions.json",
	]),
	{
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				projectService: { allowDefaultProject: ["manifest.json"] },
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"],
			},
		},
	},
	...obsidianmd.configs.recommended,
);
