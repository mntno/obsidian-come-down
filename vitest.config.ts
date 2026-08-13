import { existsSync } from "node:fs";
import path from "path";
import { defineConfig } from "vitest/config";

const src = path.resolve(import.meta.dirname, "./src");

export default defineConfig({
	resolve: {
		alias: {
			"#": src,
		},
	},
	plugins: [
		// TODO: Once all bare imports are migrated to "#/"-prefixed specifiers,
		// delete this `plugins: […]` part. The `"#": src` alias above handles all
		// resolution. Until then it mirrors tsconfig `paths: { "*": ["./src/*"] }`,
		// which Vite does not read natively.
		{
			name: "tsconfig-star-paths",
			enforce: "pre",
			resolveId(source) {
				if (/^(\.|#|@)/.test(source)) return null;
				const candidate = path.join(src, source);
				if (existsSync(candidate + ".ts")) return candidate + ".ts";
				if (existsSync(path.join(candidate, "index.ts"))) return candidate + "/index.ts";
				return null;
			},
		},
	],
	test: {
		setupFiles: ["./vitest.setup.ts"],
		silent: true,
	},
});
