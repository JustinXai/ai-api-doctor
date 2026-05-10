import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Link-AI API Manager',
    version: '0.1.0',
    permissions: ['storage', 'clipboardWrite'],
    host_permissions: ['https://api1.link-ai.cc/*'],
  },
});
