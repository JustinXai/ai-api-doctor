# AI API Manager by Link-AI

A lightweight browser extension for managing OpenAI-compatible API keys, Base URLs, model lists, connectivity testing, and client configuration export.

**Default provider:** Link-AI
**Custom providers:** supported
**API keys:** stored locally in browser storage by default

## Brand Notice

Link-AI, link-ai.cc, api1.link-ai.cc and related logos are trademarks of Link-AI and are not licensed for third-party commercial redistribution.

## License

GPL-3.0

---

## Project Structure

```
link-ai-api-manager/
├── entrypoints/                  # WXT entrypoints
│   └── popup/                    # Popup entrypoint
│       ├── index.html           # Popup HTML template
│       ├── main.tsx             # React mount point
│       └── App.tsx              # Main React app
├── src/
│   ├── components/              # Reusable React components
│   │   ├── Header.tsx           # App header
│   │   ├── StatusCard.tsx       # Provider/Key status display
│   │   ├── QuickActions.tsx      # Quick action buttons
│   │   └── PageRouter.tsx       # Navigation component
│   ├── lib/                     # Utility functions
│   │   ├── storage.ts           # Chrome storage wrapper
│   │   └── defaults.ts          # Default configuration
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

- **Provider Management**: Add, edit, delete API providers
- **API Key Storage**: Secure local storage with masked display
- **Connectivity Testing**: Test API connection with latency measurement
- **Model List**: View available models from your provider
- **Config Export**: Export configuration for Claude, OpenAI, or generic format
- **Settings**: Theme, auto-connect, and data management

## Technical Notes

- Manifest V3 browser extension
- Uses `chrome.storage.local` for local data persistence
- No content scripts (v1.0)
- Minimal permissions: `storage`, `clipboardWrite`
- Default host permission: `https://api1.link-ai.cc/*`
