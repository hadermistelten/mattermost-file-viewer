import React, {useState, useCallback, useRef, useEffect} from 'react';
import {FileNode} from '../types';

interface FileTreeProps {
    nodes: FileNode[];
    selectedPath: string;
    onSelect: (node: FileNode) => void;
    onLoadChildren: (path: string) => Promise<FileNode[]>;
    onCreateFile?: (dirPath: string) => void;
    onCreateDir?: (dirPath: string) => void;
    onDelete?: (node: FileNode) => void;
    onRename?: (node: FileNode) => void;
    allowWrite: boolean;
}

interface TreeNodeProps {
    node: FileNode;
    selectedPath: string;
    onSelect: (node: FileNode) => void;
    onLoadChildren: (path: string) => Promise<FileNode[]>;
    onCreateFile?: (dirPath: string) => void;
    onCreateDir?: (dirPath: string) => void;
    onDelete?: (node: FileNode) => void;
    onRename?: (node: FileNode) => void;
    allowWrite: boolean;
    depth: number;
}

interface ContextMenu {
    x: number;
    y: number;
    node: FileNode;
}

function getFileIcon(node: FileNode): string {
    if (node.isDir) return '📁';
    const ext = node.name.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
    case 'jpg': case 'jpeg': case 'png': case 'gif': case 'svg': case 'webp': return '🖼️';
    case 'pdf': return '📋';
    case 'md': return '📝';
    case 'json': case 'yaml': case 'yml': case 'toml': return '⚙️';
    case 'go': case 'js': case 'ts': case 'tsx': case 'jsx':
    case 'py': case 'rb': case 'rs': case 'java': case 'c': case 'cpp': case 'h': return '💻';
    case 'sh': case 'bash': return '🔧';
    default: return '📄';
    }
}

const TreeNode: React.FC<TreeNodeProps> = ({
    node, selectedPath, onSelect, onLoadChildren,
    onCreateFile, onCreateDir, onDelete, onRename, allowWrite, depth,
}) => {
    const [expanded, setExpanded] = useState(depth === 0);
    const [children, setChildren] = useState<FileNode[]>(node.children || []);
    const [loadedChildren, setLoadedChildren] = useState(false);
    const [loading, setLoading] = useState(false);
    const [contextMenu, setContextMenu] = useState<{x: number; y: number} | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close context menu on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setContextMenu(null);
            }
        };
        if (contextMenu) {
            document.addEventListener('mousedown', handler);
        }
        return () => document.removeEventListener('mousedown', handler);
    }, [contextMenu]);

    const handleClick = async () => {
        if (node.isDir) {
            if (!expanded && !loadedChildren) {
                setLoading(true);
                try {
                    const fetched = await onLoadChildren(node.path);
                    setChildren(fetched);
                    setLoadedChildren(true);
                } finally {
                    setLoading(false);
                }
            }
            setExpanded(!expanded);
        } else {
            onSelect(node);
        }
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({x: e.clientX, y: e.clientY});
    };

    const isSelected = !node.isDir && node.path === selectedPath;

    return (
        <div className='file-tree-node'>
            <div
                className={`file-tree-label${isSelected ? ' selected' : ''}`}
                style={{paddingLeft: `${depth * 14 + 6}px`}}
                onClick={handleClick}
                onContextMenu={handleContextMenu}
                title={node.path}
            >
                {node.isDir ? (
                    <span className='file-tree-arrow'>{loading ? '⏳' : (expanded ? '▼' : '▶')}</span>
                ) : (
                    <span className='file-tree-arrow'>{' '}</span>
                )}
                <span className='file-tree-icon'>{getFileIcon(node)}</span>
                <span className='file-tree-name'>{node.name}</span>
            </div>

            {contextMenu && (
                <div
                    ref={menuRef}
                    className='file-tree-context-menu'
                    style={{top: contextMenu.y, left: contextMenu.x}}
                >
                    {allowWrite && node.isDir && (
                        <>
                            <div className='ctx-item' onClick={() => { setContextMenu(null); onCreateFile && onCreateFile(node.path); }}>
                                📄 New File
                            </div>
                            <div className='ctx-item' onClick={() => { setContextMenu(null); onCreateDir && onCreateDir(node.path); }}>
                                📁 New Folder
                            </div>
                        </>
                    )}
                    {allowWrite && (
                        <>
                            <div className='ctx-item' onClick={() => { setContextMenu(null); onRename && onRename(node); }}>
                                ✏️ Rename
                            </div>
                            <div className='ctx-item ctx-danger' onClick={() => { setContextMenu(null); onDelete && onDelete(node); }}>
                                🗑️ Delete
                            </div>
                        </>
                    )}
                    {!allowWrite && (
                        <div className='ctx-item ctx-disabled'>No write access</div>
                    )}
                </div>
            )}

            {node.isDir && expanded && (
                <div className='file-tree-children'>
                    {children.length === 0 && loadedChildren && (
                        <div className='file-tree-empty-dir' style={{paddingLeft: `${(depth + 1) * 14 + 6}px`}}>
                            (empty)
                        </div>
                    )}
                    {children.map((child) => (
                        <TreeNode
                            key={child.path}
                            node={child}
                            selectedPath={selectedPath}
                            onSelect={onSelect}
                            onLoadChildren={onLoadChildren}
                            onCreateFile={onCreateFile}
                            onCreateDir={onCreateDir}
                            onDelete={onDelete}
                            onRename={onRename}
                            allowWrite={allowWrite}
                            depth={depth + 1}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const FileTree: React.FC<FileTreeProps> = ({
    nodes, selectedPath, onSelect, onLoadChildren,
    onCreateFile, onCreateDir, onDelete, onRename, allowWrite,
}) => {
    if (!nodes || nodes.length === 0) {
        return <div className='file-tree-empty'>No files found</div>;
    }

    return (
        <div className='file-tree'>
            {nodes.map((node) => (
                <TreeNode
                    key={node.path}
                    node={node}
                    selectedPath={selectedPath}
                    onSelect={onSelect}
                    onLoadChildren={onLoadChildren}
                    onCreateFile={onCreateFile}
                    onCreateDir={onCreateDir}
                    onDelete={onDelete}
                    onRename={onRename}
                    allowWrite={allowWrite}
                    depth={0}
                />
            ))}
        </div>
    );
};

export default FileTree;
