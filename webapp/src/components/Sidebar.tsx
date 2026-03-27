import React, {useState, useEffect, useCallback, useRef} from 'react';
import FileTree from './FileTree';
import FileViewer from './FileViewer';
import {FileNode, FileContent, Tab, SearchResult, PluginConfig} from '../types';

interface SidebarProps {
    pluginId: string;
}

const Sidebar: React.FC<SidebarProps> = ({pluginId}) => {
    const [rootNodes, setRootNodes] = useState<FileNode[]>([]);
    const [treeLoading, setTreeLoading] = useState(false);
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activeTabIndex, setActiveTabIndex] = useState(-1);
    const [fileLoading, setFileLoading] = useState(false);
    const [allowWrite, setAllowWrite] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchType, setSearchType] = useState<'content' | 'name'>('name');
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [showSearch, setShowSearch] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [dragOver, setDragOver] = useState(false);
    const [showDirUpload, setShowDirUpload] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const pluginApiUrl = `/plugins/${pluginId}`;

    const showStatus = (msg: string) => {
        setStatusMsg(msg);
        setTimeout(() => setStatusMsg(''), 3000);
    };

    const showError = (msg: string) => {
        setErrorMsg(msg);
        setTimeout(() => setErrorMsg(''), 5000);
    };

    // Fetch plugin config (allowWrite)
    const fetchConfig = useCallback(async () => {
        try {
            const res = await fetch(`${pluginApiUrl}/api/v1/config`);
            if (res.ok) {
                const cfg: PluginConfig = await res.json();
                setAllowWrite(cfg.allowWrite);
            }
        } catch (e) {
            console.error('File Viewer: Failed to fetch config', e);
        }
    }, [pluginApiUrl]);

    const fetchRootTree = useCallback(async () => {
        setTreeLoading(true);
        try {
            const res = await fetch(`${pluginApiUrl}/api/v1/tree`);
            if (res.ok) {
                const data = await res.json();
                setRootNodes(data || []);
            }
        } catch (e) {
            console.error('File Viewer: Failed to fetch tree', e);
        } finally {
            setTreeLoading(false);
        }
    }, [pluginApiUrl]);

    const loadChildren = useCallback(async (path: string): Promise<FileNode[]> => {
        try {
            const res = await fetch(`${pluginApiUrl}/api/v1/tree?path=${encodeURIComponent(path)}`);
            if (res.ok) {
                return await res.json() || [];
            }
        } catch (e) {
            console.error('File Viewer: Failed to load children', e);
        }
        return [];
    }, [pluginApiUrl]);

    const fetchFile = useCallback(async (node: FileNode) => {
        // Check if already open in a tab
        const existingIdx = tabs.findIndex((t) => t.path === node.path);
        if (existingIdx >= 0) {
            setActiveTabIndex(existingIdx);
            return;
        }

        setFileLoading(true);
        try {
            const res = await fetch(
                `${pluginApiUrl}/api/v1/file?path=${encodeURIComponent(node.path)}`,
            );
            if (res.ok) {
                const data: FileContent = await res.json();
                const newTab: Tab = {
                    path: node.path,
                    name: node.name,
                    content: data,
                    modified: false,
                    editContent: data.content,
                };
                setTabs((prev) => {
                    const newTabs = [...prev, newTab];
                    setActiveTabIndex(newTabs.length - 1);
                    return newTabs;
                });
            }
        } catch (e) {
            console.error('File Viewer: Failed to fetch file', e);
            showError('Failed to load file');
        } finally {
            setFileLoading(false);
        }
    }, [pluginApiUrl, tabs]);

    const handleTabClose = useCallback((index: number) => {
        setTabs((prev) => {
            const newTabs = prev.filter((_, i) => i !== index);
            setActiveTabIndex((prevActive) => {
                if (newTabs.length === 0) return -1;
                if (prevActive >= newTabs.length) return newTabs.length - 1;
                if (prevActive > index) return prevActive - 1;
                return prevActive;
            });
            return newTabs;
        });
    }, []);

    const handleContentChange = useCallback((index: number, content: string) => {
        setTabs((prev) => prev.map((t, i) =>
            i === index ? {...t, editContent: content, modified: true} : t,
        ));
    }, []);

    const handleSave = useCallback(async (index: number) => {
        const tab = tabs[index];
        if (!tab || !tab.content) return;

        try {
            const res = await fetch(
                `${pluginApiUrl}/api/v1/file?path=${encodeURIComponent(tab.path)}`,
                {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({content: tab.editContent}),
                },
            );
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to save');
            }
            // Update the tab: saved content = editContent, modified = false
            setTabs((prev) => prev.map((t, i) =>
                i === index ? {
                    ...t,
                    modified: false,
                    content: t.content ? {...t.content, content: t.editContent} : t.content,
                } : t,
            ));
            showStatus('Saved ✓');
        } catch (err: any) {
            showError(err.message || 'Failed to save');
        }
    }, [tabs, pluginApiUrl]);

    const handleSearch = useCallback(async () => {
        if (!searchQuery.trim()) return;
        setSearching(true);
        try {
            const res = await fetch(
                `${pluginApiUrl}/api/v1/search?q=${encodeURIComponent(searchQuery)}&type=${searchType}`,
            );
            if (res.ok) {
                const data = await res.json();
                setSearchResults(data || []);
            }
        } catch (e) {
            console.error('File Viewer: Search failed', e);
        } finally {
            setSearching(false);
        }
    }, [pluginApiUrl, searchQuery, searchType]);

    const handleSearchResultClick = useCallback(async (result: SearchResult) => {
        // Open or switch to the file
        const node: FileNode = {
            name: result.path.split('/').pop() || result.path,
            path: result.path,
            isDir: false,
        };
        await fetchFile(node);
    }, [fetchFile]);

    const handleCreateFile = useCallback(async (dirPath: string) => {
        const name = window.prompt('New file name:');
        if (!name) return;
        const filePath = dirPath === '.' ? name : `${dirPath}/${name}`;
        try {
            const res = await fetch(
                `${pluginApiUrl}/api/v1/file?path=${encodeURIComponent(filePath)}`,
                {method: 'POST'},
            );
            if (!res.ok) {
                const data = await res.json();
                showError(data.error || 'Failed to create file');
                return;
            }
            showStatus(`Created ${filePath}`);
            fetchRootTree();
        } catch (e: any) {
            showError(e.message);
        }
    }, [pluginApiUrl, fetchRootTree]);

    const handleCreateDir = useCallback(async (dirPath: string) => {
        const name = window.prompt('New folder name:');
        if (!name) return;
        const newPath = dirPath === '.' ? name : `${dirPath}/${name}`;
        try {
            const res = await fetch(
                `${pluginApiUrl}/api/v1/mkdir?path=${encodeURIComponent(newPath)}`,
                {method: 'POST'},
            );
            if (!res.ok) {
                const data = await res.json();
                showError(data.error || 'Failed to create folder');
                return;
            }
            showStatus(`Created folder ${newPath}`);
            fetchRootTree();
        } catch (e: any) {
            showError(e.message);
        }
    }, [pluginApiUrl, fetchRootTree]);

    const handleDelete = useCallback(async (node: FileNode) => {
        const type = node.isDir ? 'folder' : 'file';
        if (!window.confirm(`Delete ${type} "${node.name}"?`)) return;

        try {
            const res = await fetch(
                `${pluginApiUrl}/api/v1/file?path=${encodeURIComponent(node.path)}`,
                {method: 'DELETE'},
            );
            if (!res.ok) {
                const data = await res.json();
                showError(data.error || 'Failed to delete');
                return;
            }
            // Close tab if open
            const tabIdx = tabs.findIndex((t) => t.path === node.path);
            if (tabIdx >= 0) handleTabClose(tabIdx);
            showStatus(`Deleted ${node.path}`);
            fetchRootTree();
        } catch (e: any) {
            showError(e.message);
        }
    }, [pluginApiUrl, tabs, handleTabClose, fetchRootTree]);

    const handleRename = useCallback(async (node: FileNode) => {
        const dirPart = node.path.includes('/') ? node.path.split('/').slice(0, -1).join('/') : '';
        const newName = window.prompt('New name:', node.name);
        if (!newName || newName === node.name) return;
        const newPath = dirPart ? `${dirPart}/${newName}` : newName;

        try {
            const res = await fetch(`${pluginApiUrl}/api/v1/rename`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({oldPath: node.path, newPath}),
            });
            if (!res.ok) {
                const data = await res.json();
                showError(data.error || 'Failed to rename');
                return;
            }
            // Update tab path if open
            setTabs((prev) => prev.map((t) =>
                t.path === node.path ? {...t, path: newPath, name: newName} : t,
            ));
            showStatus(`Renamed to ${newName}`);
            fetchRootTree();
        } catch (e: any) {
            showError(e.message);
        }
    }, [pluginApiUrl, fetchRootTree]);

    // Drag and drop upload
    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (!allowWrite) return;

        const formData = new FormData();
        formData.append('dir', '.');
        for (const file of Array.from(e.dataTransfer.files)) {
            formData.append('files', file);
        }

        try {
            const res = await fetch(`${pluginApiUrl}/api/v1/upload`, {
                method: 'POST',
                body: formData,
            });
            if (!res.ok) {
                const data = await res.json();
                showError(data.error || 'Upload failed');
                return;
            }
            const data = await res.json();
            showStatus(`Uploaded: ${(data.files || []).join(', ')}`);
            fetchRootTree();
        } catch (e: any) {
            showError(e.message);
        }
    }, [pluginApiUrl, allowWrite, fetchRootTree]);

    useEffect(() => {
        fetchConfig();
        fetchRootTree();
    }, [fetchConfig, fetchRootTree]);

    // WebSocket refresh handler
    useEffect(() => {
        const handler = () => {
            fetchRootTree();
            // Refresh active tab content
            if (activeTabIndex >= 0 && tabs[activeTabIndex]) {
                const tab = tabs[activeTabIndex];
                if (!tab.modified) {
                    fetchFile({name: tab.name, path: tab.path, isDir: false});
                }
            }
        };
        (window as any).__fileViewerRefresh = handler;
        return () => { delete (window as any).__fileViewerRefresh; };
    }, [fetchRootTree, fetchFile, activeTabIndex, tabs]);

    const handleSearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSearch();
    };

    return (
        <div
            className={`file-viewer-sidebar${dragOver ? ' drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
        >
            {/* Header */}
            <div className='file-viewer-header'>
                <span className='header-title'>📂 File Viewer</span>
                <div className='header-actions'>
                    <button
                        className={`icon-btn${showSearch ? ' active' : ''}`}
                        onClick={() => setShowSearch(!showSearch)}
                        title='Search'
                    >🔍</button>
                    <button
                        className='icon-btn'
                        onClick={fetchRootTree}
                        disabled={treeLoading}
                        title='Refresh'
                    >{treeLoading ? '⏳' : '🔄'}</button>
                    {allowWrite && (
                        <button
                            className='icon-btn'
                            onClick={() => fileInputRef.current?.click()}
                            title='Upload files'
                        >⬆️</button>
                    )}
                </div>
            </div>

            {/* Hidden file input for upload */}
            {allowWrite && (
                <input
                    ref={fileInputRef}
                    type='file'
                    multiple
                    style={{display: 'none'}}
                    onChange={async (e) => {
                        if (!e.target.files?.length) return;
                        const formData = new FormData();
                        formData.append('dir', '.');
                        for (const f of Array.from(e.target.files)) {
                            formData.append('files', f);
                        }
                        try {
                            const res = await fetch(`${pluginApiUrl}/api/v1/upload`, {
                                method: 'POST',
                                body: formData,
                            });
                            if (res.ok) {
                                const data = await res.json();
                                showStatus(`Uploaded: ${(data.files || []).join(', ')}`);
                                fetchRootTree();
                            }
                        } catch (err: any) {
                            showError(err.message);
                        }
                        e.target.value = '';
                    }}
                />
            )}

            {/* Search panel */}
            {showSearch && (
                <div className='search-panel'>
                    <div className='search-row'>
                        <input
                            className='search-input'
                            placeholder='Search...'
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                        />
                        <button onClick={handleSearch} disabled={searching}>
                            {searching ? '⏳' : '🔍'}
                        </button>
                    </div>
                    <div className='search-type-row'>
                        <label>
                            <input
                                type='radio'
                                value='name'
                                checked={searchType === 'name'}
                                onChange={() => setSearchType('name')}
                            />
                            {' '}Filename
                        </label>
                        <label>
                            <input
                                type='radio'
                                value='content'
                                checked={searchType === 'content'}
                                onChange={() => setSearchType('content')}
                            />
                            {' '}Content
                        </label>
                    </div>
                    {searchResults.length > 0 && (
                        <div className='search-results'>
                            {searchResults.map((r, i) => (
                                <div
                                    key={i}
                                    className='search-result-item'
                                    onClick={() => handleSearchResultClick(r)}
                                    title={r.path}
                                >
                                    <span className='sr-path'>{r.path}</span>
                                    {r.line > 0 && <span className='sr-line'>:{r.line}</span>}
                                    {r.content && <span className='sr-content'>{r.content}</span>}
                                </div>
                            ))}
                        </div>
                    )}
                    {searching === false && searchResults.length === 0 && searchQuery && (
                        <div className='search-no-results'>No results</div>
                    )}
                </div>
            )}

            {/* Split layout: tree left, viewer right */}
            <div className='file-viewer-split'>
                {/* File Tree */}
                <div className='file-viewer-tree-panel'>
                    <FileTree
                        nodes={rootNodes}
                        selectedPath={tabs[activeTabIndex]?.path || ''}
                        onSelect={fetchFile}
                        onLoadChildren={loadChildren}
                        onCreateFile={allowWrite ? handleCreateFile : undefined}
                        onCreateDir={allowWrite ? handleCreateDir : undefined}
                        onDelete={allowWrite ? handleDelete : undefined}
                        onRename={allowWrite ? handleRename : undefined}
                        allowWrite={allowWrite}
                    />
                    {allowWrite && (
                        <div className='tree-footer'>
                            <button
                                className='new-file-btn'
                                onClick={() => handleCreateFile('.')}
                                title='New file in root'
                            >+ New File</button>
                            <button
                                className='new-file-btn'
                                onClick={() => handleCreateDir('.')}
                                title='New folder in root'
                            >+ New Folder</button>
                        </div>
                    )}
                </div>

                {/* File Viewer */}
                <div className='file-viewer-editor-panel'>
                    <FileViewer
                        tabs={tabs}
                        activeTabIndex={activeTabIndex}
                        loading={fileLoading}
                        pluginId={pluginId}
                        allowWrite={allowWrite}
                        onTabSelect={setActiveTabIndex}
                        onTabClose={handleTabClose}
                        onContentChange={handleContentChange}
                        onSave={handleSave}
                    />
                </div>
            </div>

            {/* Status / error bar */}
            {statusMsg && <div className='status-bar success'>{statusMsg}</div>}
            {errorMsg && <div className='status-bar error'>{errorMsg}</div>}
            {dragOver && allowWrite && (
                <div className='drag-overlay'>Drop files to upload</div>
            )}
        </div>
    );
};

export default Sidebar;
