import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

// Injected only when both values are configured. Hardcoding the tag with %VAR%
// placeholders left the literal text in the HTML whenever analytics was unset, so the
// browser requested "/%VITE_ANALYTICS_ENDPOINT%/umami" — a path Express cannot
// percent-decode, which surfaced as a URIError stack trace on every page load.
function analyticsPlugin(endpoint: string, websiteId: string): Plugin {
  return {
    name: "analytics-script",
    transformIndexHtml() {
      if (!endpoint || !websiteId) return [];
      return [{
        tag: "script",
        attrs: { defer: true, src: `${endpoint.replace(/\/$/, "")}/umami`, "data-website-id": websiteId },
        injectTo: "body",
      }];
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(import.meta.dirname), "");
  return {
  plugins: [react(), tailwindcss(), jsxLocPlugin(), analyticsPlugin(env.VITE_ANALYTICS_ENDPOINT, env.VITE_ANALYTICS_WEBSITE_ID)],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: ["localhost", "127.0.0.1"],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  };
});
