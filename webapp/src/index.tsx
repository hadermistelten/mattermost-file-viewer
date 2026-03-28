import React from 'react';
import Sidebar from './components/Sidebar';
import {PluginRegistry} from './types';
import './styles.css';

const PLUGIN_ID = 'com.brokk-sindre.file-viewer';

class FileViewerPlugin {
    initialize(registry: PluginRegistry, store: any): void {
        // Use registerAppBarComponent — it handles RHS toggle automatically
        // No Redux dispatch needed, avoids thunk/dispatch issues
        registry.registerAppBarComponent(
            `/plugins/${PLUGIN_ID}/assets/icon.svg`,
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
