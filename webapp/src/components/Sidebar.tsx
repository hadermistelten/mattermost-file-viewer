import React, {useState, useEffect, useCallback} from 'react';
import FileTree from './FileTree';
import FileViewer from './FileViewer';
import {FileNode, FileContent} from '../types';

interface SidebarProps {
    pluginId: string;
}

const Sidebar: React.FC<SidebarProps> = ({pluginId}) => {
    const [tree, setTree] = useState<FileNode[]>([]);
    const [selectedFile, setSelectedFile] = useState<FileContent | null>(null);
    const [selectedPath, setSelectedPath] = useState('');
    const [loading, setLoading] = useState(false);
    const [treeLoading, setTreeLoading] = useState(false);

    const pluginApiUrl = `/plugins/${pluginId}`;

    const fetchTree = useCallback(async () => {
        setTreeLoading(true);
        try {
            const response = await fetch(`${pluginApiUrl}/api/v1/tree`);
            if (response.ok) {
                const data = await response.json();
                setTree(data || []);
            }
        } catch (err) {
            console.error('File Viewer: Failed to fetch tree', err);
        } finally {
            setTreeLoading(false);
        }
    }, [pluginApiUrl]);

    const fetchFile = useCallback(async (path: string) => {
        setLoading(true);
        setSelectedPath(path);
        try {
            const response = await fetch(
                `${pluginApiUrl}/api/v1/file?path=${encodeURIComponent(path)}`,
            );
            if (response.ok) {
                const data: FileContent = await response.json();
                setSelectedFile(data);
            }
        } catch (err) {
            console.error('File Viewer: Failed to fetch file', err);
        } finally {
            setLoading(false);
        }
    }, [pluginApiUrl]);

    useEffect(() => {
        fetchTree();
    }, [fetchTree]);

    // Listen for WebSocket events to refresh tree
    useEffect(() => {
        const handler = () => {
            fetchTree();
            // If the changed file is currently selected, refresh it too
            if (selectedPath) {
                fetchFile(selectedPath);
            }
        };

        // Store handler on window for the plugin to call
        (window as any).__fileViewerRefresh = handler;

        return () => {
            delete (window as any).__fileViewerRefresh;
        };
    }, [fetchTree, fetchFile, selectedPath]);

    const handleSelect = (node: FileNode) => {
        if (!node.isDir) {
            fetchFile(node.path);
        }
    };

    return (
        <div className="file-viewer-sidebar">
            <div className="file-viewer-header">
                <span>📂 File Viewer</span>
                <button onClick={fetchTree} disabled={treeLoading}>
                    {treeLoading ? '⏳' : '🔄'} Refresh
                </button>
            </div>
            <FileTree
                nodes={tree}
                selectedPath={selectedPath}
                onSelect={handleSelect}
            />
            <FileViewer
                file={selectedFile}
                loading={loading}
                pluginId={pluginId}
                allowWrite={true}
            />
        </div>
    );
};

export default Sidebar;
