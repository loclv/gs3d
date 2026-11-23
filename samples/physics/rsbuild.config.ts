import { defineConfig } from "@rsbuild/core";

// Docs: https://rsbuild.rs/config/
export default defineConfig({
	html: {
		title: "Goose 3D Model Lab",
		meta: {
			description:
				"Create and export editable 3D models with a WebGPU-first, WebGL2-fallback preview.",
		},
	},
	server: {
		port: 3001,
	},
});
