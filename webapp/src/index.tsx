import React from 'react';
import Sidebar from './components/Sidebar';
import {PluginRegistry} from './types';
import './styles.css';

const PLUGIN_ID = 'com.brokk-sindre.file-viewer';

// Inline SVG icon as data URI — avoids asset serving issues
const ICON_URL = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">' +
    '<rect width="100" height="100" rx="12" fill="#166DE0"/>' +
    '<path d="M25 25h20l5 5h25v45H25V25z" fill="none" stroke="white" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M35 45h30M35 55h20M35 65h25" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' +
    '</svg>',
);

class FileViewerPlugin {
    initialize(registry: PluginRegistry, store: any): void {
        // Use registerAppBarComponent — it handles RHS toggle automatically
        // No Redux dispatch needed, avoids thunk/dispatch issues
        registry.registerAppBarComponent(
            ICON_URL,
            null, // no action callback — rhsComponent handles it
            'File Viewer',
            null, // all products
            () => <Sidebar pluginId={PLUGIN_ID} />,
            'File Viewer',
        );

        // Register WebSocket event handler for file changes
        registry.registerWebSocketEventHandler(
            `custom_${PLUGIN_ID}_file_viewer_changed`,
            () => {
                const refresh = (window as any).__fileViewerRefresh;
                if (typeof refresh === 'function') {
                    refresh();
                }
            },
        );
    }

    uninitialize(): void {
        delete (window as any).__fileViewerRefresh;
    }
}

// Register the plugin with Mattermost webapp
(window as any).registerPlugin(PLUGIN_ID, new FileViewerPlugin());
