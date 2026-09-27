export default defineNuxtConfig({
  compatibilityDate: '2026-09-15',
  srcDir: 'frontend',
  serverDir: 'backend/http',
  ssr: false,
  devtools: { enabled: false },
  devServer: { host: '127.0.0.1' },
  app: { buildAssetsDir: '/_nuxt/', head: { title: "VibeCLI" } },
  nitro: { preset: 'node-server', prerender: { routes: ['/'] } },
});
