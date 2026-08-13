// https://typescript-eslint.io/packages/typescript-eslint#usage
import eslint from "@eslint/js";
import obsidianmd from "eslint-plugin-obsidianmd";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

// If using Svelte
// import sveltePlugin from "eslint-plugin-svelte";
// import svelteParser from "svelte-eslint-parser";

export default defineConfig(
	{
		ignores: [
			"**/dev-vault/**",
			"**/dist/**",
			"**/temp/**",
		],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended, // https://typescript-eslint.io/users/configs#recommended-configurations
	...obsidianmd.configs.recommendedWithLocalesEn,
	{
		files: ["esbuild.config.mjs", "version-bump.mjs", "vitest.config.ts", "vitest.setup.ts"],
		rules: {
			"obsidianmd/no-nodejs-modules": "off",
		},
	},
	{
		files: ["**/*.ts", "**/*.tsx"],
		plugins: {
			"@typescript-eslint": tseslint.plugin, // https://typescript-eslint.io/packages/typescript-eslint#manual-usage
		},
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				projectService: {
					allowDefaultProject: ["vitest.config.ts", "vitest.setup.ts"],
				},
				sourceType: "module",
				ecmaVersion: 2022,
			},
			globals: {
				...globals.browser,
				...globals.node,

				// Instead of adding `obsidian-typings` package. Add whatever is used here instead.
				//createDiv: "readonly",
			}
		},
		rules: {
			"no-param-reassign": ["warn", { "props": false }],

			// You should always have "no-unused-vars": "off" alongside @typescript-eslint/no-unused-vars,
			// https://typescript-eslint.io/rules/no-unused-vars/
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": ["error", {
				"args": "all",
				"argsIgnorePattern": "^_",
				"caughtErrors": "all",
				"caughtErrorsIgnorePattern": "^_",
				"destructuredArrayIgnorePattern": "^_",
				"varsIgnorePattern": "^_",
				"ignoreRestSiblings": true,
			}],

			//
			"@typescript-eslint/ban-ts-comment": ["error", {
				"ts-expect-error": false,
				"ts-ignore": true,
				"ts-nocheck": true,
				"ts-check": true,
			}],

			"no-prototype-builtins": "off",
			"@typescript-eslint/no-empty-function": "off",
			"@typescript-eslint/no-unnecessary-condition": ["warn", {
				// https://typescript-eslint.io/rules/no-unnecessary-condition/#only-allowed-literals
				"allowConstantLoopConditions": "only-allowed-literals"
			}],
			"@typescript-eslint/switch-exhaustiveness-check": "error",
		},
	},
);
