// https://typescript-eslint.io/packages/typescript-eslint#usage
import eslint from "@eslint/js";
import { defineConfig } from 'eslint/config';
import tseslint from "typescript-eslint";
import globals from "globals";

//import obsidianmd from "eslint-plugin-obsidianmd";

// If using Svelte
// import sveltePlugin from "eslint-plugin-svelte";
// import svelteParser from "svelte-eslint-parser";

export default defineConfig(
	{
		ignores: [
			"**/build/**",
			"**/dist/**",
			"./main.js",
			"./src/**/*js",
		],
	},
	eslint.configs.recommended,
	// https://typescript-eslint.io/users/configs#recommended-configurations
	...tseslint.configs.recommended,
	//...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts", "**/*.tsx"],
		plugins: {
			// https://typescript-eslint.io/packages/typescript-eslint#manual-usage
			"@typescript-eslint": tseslint.plugin,
		},
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				projectService: true,
				sourceType: "module",
				ecmaVersion: "latest",
			},
			globals: {
				...globals.browser,
				...globals.node,

				// Instead of adding `obsidian-typings` package. Add whatever is used here instead.
				//createDiv: "readonly",
			}
		},
		rules: {
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
