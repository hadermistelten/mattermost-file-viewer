import React from 'react';
import Sidebar from './components/Sidebar';
import {PluginRegistry} from './types';
import './styles.css';

const PLUGIN_ID = 'com.brokk-sindre.file-viewer';

// Folder icon component for the channel header button
const FolderIcon: React.FC = () => (
    <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
    >
        <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z" />
    </svg>
);

export default class FileViewerPlugin {
    private showRHS: (() => void) | null = null;

    initialize(registry: PluginRegistry, store: any): void {
        // Register the right-hand sidebar component
        const {showRHSAction} = registry.registerRightHandSidebarComponent(
            () => <Sidebar pluginId={PLUGIN_ID} />,
        );
        this.showRHS = () => store.dispatch(showRHSAction);

        // Register channel header button
        registry.registerChannelHeaderButtonAction(
            FolderIcon,
            () => {
                if (this.showRHS) {
                    this.showRHS();
                }
            },
            'File Viewer',
            'Open File Viewer',
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
        this.showRHS = null;
        delete (window as any).__fileViewerRefresh;
    }
}
