import React, {useState, useRef, useEffect} from 'react';
import {FileNode} from '../types';

export interface MenuRequest {
    x: number;
    y: number;
    node: FileNode;
}

interface FileTreeProps {
    nodes: FileNode[];
    selectedPath: string;
    onSelect: (node: FileNode) => void;
    onLoadChildren: (path: string) => Promise<FileNode[]>;
    onMove?: (sourcePath: string, destDir: string) => void;
    onMenuRequest: (req: MenuRequest) => void;
    allowWrite: boolean;
}

interface TreeNodeProps {
    node: FileNode;
    selectedPath: string;
    onSelect: (node: FileNode) => void;
    onLoadChildren: (path: string) => Promise<FileNode[]>;
    onMove?: (sourcePath: string, destDir: string) => void;
    onMenuRequest: (req: MenuRequest) => void;
    allowWrite: boolean;
    depth: number;
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
    node, selectedPath, onSelect, onLoadChildren, onMove, onMenuRequest, allowWrite, depth,
}) => {
    const [expanded, setExpanded] = useState(depth === 0);
    const [children, setChildren] = useState<FileNode[]>(node.children || []);
    const [loadedChildren, setLoadedChildren] = useState(false);
    const [loading, setLoading] = useState(false);
    const [dragOverThis, setDragOverThis] = useState(false);
    const labelRef = useRef<HTMLDivElement>(null);

    // Native contextmenu listener
    useEffect(() => {
        const el = labelRef.current;
        if (!el) return;
        const handler = (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            onMenuRequest({x: e.clientX, y: e.clientY, node});
        };
        el.addEventListener('contextmenu', handler, true);
        return () => el.removeEventListener('contextmenu', handler, true);
    }, [node, onMenuRequest]);

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

    const handleKebabClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onMenuRequest({x: rect.right, y: rect.top, node});
    };

    const handleDragStart = (e: React.DragEvent) => {
        if (!allowWrite) return;
        e.dataTransfer.setData('text/plain', node.path);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (!allowWrite || !node.isDir) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setDragOverThis(true);
    };

    const handleDragLeave = () => setDragOverThis(false);

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOverThis(false);
        if (!allowWrite || !node.isDir) return;
        const sourcePath = e.dataTransfer.getData('text/plain');
        if (sourcePath && sourcePath !== node.path && onMove) {
            onMove(sourcePath, node.path);
        }
    };

    const isSelected = !node.isDir && node.path === selectedPath;

    return (
        <div className='file-tree-node'>
            <div
                ref={labelRef}
                className={`file-tree-label${isSelected ? ' selected' : ''}${dragOverThis ? ' drop-target' : ''}`}
                style={{paddingLeft: `${depth * 14 + 6}px`}}
                onClick={handleClick}
                draggable={allowWrite}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                title={node.path}
            >
                {node.isDir ? (
                    <span className='file-tree-arrow'>{loading ? '⏳' : (expanded ? '▼' : '▶')}</span>
                ) : (
                    <span className='file-tree-arrow'>{' '}</span>
                )}
                <span className='file-tree-icon'>{getFileIcon(node)}</span>
                <span className='file-tree-name'>{node.name}</span>
                <span className='file-tree-kebab' onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); handleKebabClick(e); }}>⋮</span>
            </div>

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
                            onMove={onMove}
                            onMenuRequest={onMenuRequest}
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
    nodes, selectedPath, onSelect, onLoadChildren, onMove, onMenuRequest, allowWrite,
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
                    onMove={onMove}
                    onMenuRequest={onMenuRequest}
                    allowWrite={allowWrite}
                    depth={0}
                />
            ))}
        </div>
    );
};

export default FileTree;
