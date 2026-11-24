import { defineConfig } from "@rsbuild/core";

// Docs: https://rsbuild.rs/config/
export default defineConfig({
	html: {
		title: "Goose 3D Water Lab",
		meta: {
			description:
				"Buoyancy and hydrodynamic drag on the gs3d physics solver — floaters, sinkers and a live water level.",
		},
	},
	server: {
		port: 3002,
	},
});
