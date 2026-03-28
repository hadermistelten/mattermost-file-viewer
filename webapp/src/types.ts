export interface FileNode {
    name: string;
    path: string;
    isDir: boolean;
    size?: number;
    children?: FileNode[];
    loaded?: boolean; // lazy: children fetched?
}

export interface FileContent {
    path: string;
    name: string;
    content: string;
    mimeType: string;
    isBase64: boolean;
    size: number;
}

export interface SearchResult {
    path: string;
    line: number;
    content: string;
}

export interface Tab {
    path: string;
    name: string;
    content: FileContent | null;
    modified: boolean;
    editContent: string;
}

export interface PluginConfig {
    allowWrite: boolean;
}

export interface PluginRegistry {
    registerRightHandSidebarComponent(component: React.ComponentType<any>, title?: string): { id: string; showRHSAction: any };
    registerChannelHeaderButtonAction(
        icon: React.ComponentType,
        action: () => void,
        dropdownText: string,
        tooltipText: string,
    ): void;
    registerAppBarComponent(
        iconUrl: string,
        action: ((channel: any, member: any) => void) | null,
        tooltipText: string,
        supportedProductIds: string[] | null,
        rhsComponent?: React.ComponentType<any> | (() => JSX.Element),
        rhsTitle?: string,
    ): void;
    registerWebSocketEventHandler(
        eventType: string,
        handler: (event: any) => void,
    ): void;
    unregisterWebSocketEventHandler(eventType: string): void;
}

export interface PluginStore {
    dispatch: (action: any) => void;
    getState: () => any;
}
