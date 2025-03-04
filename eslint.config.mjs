
import js from "@eslint/js";
import globals from "globals";

import typeScriptPlugin from "@typescript-eslint/eslint-plugin";
import typeScriptParser from "@typescript-eslint/parser";

// If using Svelte
// import sveltePlugin from "eslint-plugin-svelte";
// import svelteParser from "svelte-eslint-parser";


export default [  
  {
    files: ["**/*.ts", "**/*.tsx"],  
    plugins: {
      "@typescript-eslint": typeScriptPlugin,
    },  
    languageOptions: {
      parser: typeScriptParser,
      parserOptions: {
        project: './tsconfig.json',
        sourceType: 'module',
        ecmaVersion: "latest",
      },
      globals: {
        ...globals.browser,
        //...globals.node
      }     
    },
    rules: {      
      ...js.configs.recommended.rules,
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { "args": "none" }],
      "@typescript-eslint/ban-ts-comment": "off",            
      "no-prototype-builtins": "off",
      "@typescript-eslint/no-empty-function": "off",
    }
  },
  {
    ignores: [
      "**/*js",
      "**/node_modules/**",
    ],
  },
];