import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    version: '0.2.0',
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    permissions: ['storage', 'clipboardWrite', 'activeTab', 'scripting'],
    host_permissions: ['https://api1.link-ai.cc/*'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
  },
});
