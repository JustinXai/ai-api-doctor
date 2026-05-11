# AI API Doctor

Local-first diagnostic tool for OpenAI-compatible API keys, Base URLs, model access, usage and client configs.

**Default provider:** Link-AI (built-in, for quick-start)
**Custom providers:** fully supported
**API keys:** stored locally in browser storage

## Brand Notice

Link-AI (link-ai.cc) is the default/built-in provider and a sponsor of this project. All other providers are treated equally. This tool is not affiliated with or endorsed by any relay provider.

Link-AI, link-ai.cc, api1.link-ai.cc and related logos are trademarks of Link-AI and are not licensed for third-party commercial redistribution.

## License

GPL-3.0

---

## Project Structure

```
ai-api-doctor/
├── entrypoints/                  # WXT entrypoints
│   └── popup/                    # Popup entrypoint
│       ├── index.html           # Popup HTML template
│       ├── main.tsx             # React mount point
│       └── App.tsx              # Main React app
├── src/
│   ├── components/              # Reusable React components
│   │   ├── Header.tsx           # App header
│   │   ├── StatusCard.tsx       # Provider/Key status display
│   │   └── PageRouter.tsx       # Navigation component
│   ├── lib/                     # Utility functions
│   │   ├── storage.ts           # Chrome storage wrapper
│   │   ├── defaults.ts          # Default configuration
│   │   ├── diagnosis.ts         # Diagnosis logic
│   │   └── i18n.ts             # Internationalization
│   ├── pages/                   # Page components
│   │   ├── ProvidersPage.tsx    # Provider management
│   │   ├── KeysPage.tsx         # API Key management
│   │   ├── ModelsPage.tsx       # Model list viewer
│   │   ├── ExportPage.tsx       # Config export
│   │   └── SettingsPage.tsx     # Settings page
│   ├── styles/                  # CSS styles
│   │   └── popup.css            # Popup styles
│   └── types/                  # TypeScript types
│       └── index.ts             # Type definitions
├── _locales/                    # i18n locale files
│   ├── en/messages.json         # English strings
│   └── zh_CN/messages.json      # Chinese strings
├── wxt.config.ts                # WXT configuration
├── tsconfig.json                # TypeScript config
└── package.json                 # Dependencies
```

## Development Setup

### Prerequisites

- Node.js 18+
- npm 8+ (or pnpm)

### Initialize Project

```bash
# Install dependencies
npm install

# Build for development (rebuild after code changes)
npm run build:dev
```

### Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `.output/chrome-mv3` directory
5. Click the extension icon to open the popup

### Development Workflow

```bash
# Make code changes in src/ and entrypoints/

# Rebuild after changes
npm run build:dev

# Refresh the extension in Chrome (click refresh icon on extension card)
```

### Build for Production

```bash
npm run build
```

The production build will be in `.output/chrome-mv3-prod/`.

## Features

- **API Key & Base URL Testing**: Diagnose connectivity and authentication
- **Model Access Check**: Test model availability with actual chat completion
- **Usage Audit**: Check whether the response returns usage data and flag anomalies
- **Provider Management**: Add, edit, delete any OpenAI-compatible provider
- **Config Export**: Export for Cline, Continue, OpenAI SDK, cURL, or .env format
- **Bilingual**: Supports English and Simplified Chinese

## Technical Notes

- Manifest V3 browser extension
- Uses `chrome.storage.local` for local data persistence
- Minimal permissions: `storage`, `clipboardWrite`
- Default host permission: `https://api1.link-ai.cc/*` (for built-in provider)
