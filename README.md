# 📂 File Viewer — Mattermost Plugin

A VS Code-inspired file tree and viewer/editor for Mattermost. Browse, view, and edit server-side files directly from the right sidebar.

![Screenshot Placeholder](assets/screenshot.png)

## Features

- **📁 File Tree** — Browse a configured server directory with collapsible folder navigation
- **💻 Code Viewer/Editor** — View and edit text files with a monospace editor
- **🖼️ Image Preview** — Inline preview for JPG, PNG, GIF, SVG, and WebP images
- **📋 PDF Viewer** — Embedded PDF viewing
- **⬇️ Downloads** — Download any file directly from the viewer
- **🔄 Live Refresh** — Auto-updates via filesystem watching (fsnotify + WebSocket)
- **🔒 Path Security** — Full path traversal protection; files are sandboxed to the configured root
- **🎨 Theme Support** — Matches Mattermost's light and dark themes

## Installation

### From Release

1. Download the latest `.tar.gz` from [Releases](https://github.com/Brokk-Sindre/mattermost-file-viewer/releases)
2. Go to **System Console → Plugin Management**
3. Upload the `.tar.gz` file
4. Enable the plugin

### Building from Source

**Prerequisites:**
- Go 1.21+
- Node.js 18+
- npm 9+

```bash
# Clone the repository
git clone https://github.com/Brokk-Sindre/mattermost-file-viewer.git
cd mattermost-file-viewer

# Build everything (server + webapp + bundle)
make all

# The plugin bundle will be created as:
# com.brokk-sindre.file-viewer-1.0.0.tar.gz
```

To build server binaries for all platforms:
```bash
make server-all
```

## Configuration

Go to **System Console → Plugins → File Viewer** and configure:

| Setting | Description | Default |
|---------|------------|---------|
| **Root Path** | Absolute path to the directory to expose | _(empty)_ |
| **Allowed Extensions** | Comma-separated list of allowed file extensions (empty = all) | _(empty)_ |
| **Allow Write** | Allow users to edit and save files | `false` |

### Examples

```
Root Path: /home/agent/workspace
Allowed Extensions: .go,.js,.ts,.tsx,.md,.txt,.json,.yaml,.yml,.css,.html
Allow Write: true
```

## Usage

1. Click the **📁 folder icon** in the channel header to open the File Viewer sidebar
2. Browse the file tree — click folders to expand/collapse
3. Click a file to view its contents:
   - **Text/code files** are shown in a monospace editor
   - **Images** are displayed inline
   - **PDFs** are embedded in an iframe
   - **Other files** show a download button
4. If **Allow Write** is enabled, edit text files and click **Save**
5. The tree auto-refreshes when files change on disk

## Security

- All file paths are validated to prevent path traversal attacks
- Files are sandboxed to the configured `RootPath`
- Hidden files/directories (starting with `.`) are excluded
- Write access must be explicitly enabled
- Extension filtering can restrict which file types are accessible

## Development

```bash
# Build server only
make server

# Build webapp only (with watch mode)
cd webapp && npm run dev

# Clean build artifacts
make clean
```

## Architecture

```
mattermost-file-viewer/
├── plugin.json          # Plugin manifest
├── assets/              # Plugin icon
├── server/              # Go server plugin
│   ├── plugin.go        # Plugin lifecycle
│   ├── configuration.go # Config management
│   ├── api.go           # HTTP API endpoints
│   └── watcher.go       # Filesystem watcher
├── webapp/              # React webapp
│   └── src/
│       ├── index.tsx           # Plugin registration
│       ├── types.ts            # TypeScript interfaces
│       ├── styles.css          # Theming
│       └── components/
│           ├── Sidebar.tsx     # Main container
│           ├── FileTree.tsx    # File tree navigation
│           └── FileViewer.tsx  # File content viewer
└── Makefile             # Build system
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/tree` | Returns JSON file tree |
| `GET` | `/api/v1/file?path=...` | Returns file content |
| `PUT` | `/api/v1/file?path=...` | Saves file content |
| `GET` | `/api/v1/download?path=...` | Downloads a file |

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
