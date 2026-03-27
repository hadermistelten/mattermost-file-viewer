import React, {useState} from 'react';
import {FileNode} from '../types';

interface FileTreeProps {
    nodes: FileNode[];
    selectedPath: string;
    onSelect: (node: FileNode) => void;
}

interface TreeNodeProps {
    node: FileNode;
    selectedPath: string;
    onSelect: (node: FileNode) => void;
    depth: number;
}

function getFileIcon(node: FileNode): string {
    if (node.isDir) {
        return '📁';
    }
    const ext = node.name.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'svg':
    case 'webp':
        return '🖼️';
    case 'pdf':
        return '📋';
    case 'md':
        return '📝';
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
        return '⚙️';
    case 'go':
    case 'js':
    case 'ts':
    case 'tsx':
    case 'py':
    case 'rb':
    case 'rs':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
        return '💻';
    case 'sh':
    case 'bash':
        return '🔧';
    default:
        return '📄';
    }
}

const TreeNode: React.FC<TreeNodeProps> = ({node, selectedPath, onSelect, depth}) => {
    const [expanded, setExpanded] = useState(depth < 1);

    const handleClick = () => {
        if (node.isDir) {
            setExpanded(!expanded);
        } else {
            onSelect(node);
        }
    };

    const isSelected = !node.isDir && node.path === selectedPath;

    return (
        <div className="file-tree-node">
            <div
                className={`file-tree-label${isSelected ? ' selected' : ''}`}
                style={{paddingLeft: `${depth * 12 + 8}px`}}
                onClick={handleClick}
                title={node.path}
            >
                {node.isDir && (
                    <span className="file-tree-arrow">
                        {expanded ? '▼' : '▶'}
                    </span>
                )}
                {!node.isDir && <span className="file-tree-arrow">{' '}</span>}
                <span className="file-tree-icon">{getFileIcon(node)}</span>
                <span className="file-tree-name">{node.name}</span>
            </div>
            {node.isDir && expanded && node.children && (
                <div className="file-tree-children">
                    {node.children.map((child) => (
                        <TreeNode
                            key={child.path}
                            node={child}
                            selectedPath={selectedPath}
                            onSelect={onSelect}
                            depth={depth + 1}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const FileTree: React.FC<FileTreeProps> = ({nodes, selectedPath, onSelect}) => {
    if (!nodes || nodes.length === 0) {
        return <div className="file-tree-empty">No files found</div>;
    }

    return (
        <div className="file-tree">
            {nodes.map((node) => (
                <TreeNode
                    key={node.path}
                    node={node}
                    selectedPath={selectedPath}
                    onSelect={onSelect}
                    depth={0}
                />
            ))}
        </div>
    );
};

export default FileTree;
