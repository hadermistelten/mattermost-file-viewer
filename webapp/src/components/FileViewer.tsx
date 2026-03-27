import React, {useState, useEffect, useCallback, useRef} from 'react';
import {FileContent, Tab} from '../types';

// Lazy-import monaco to avoid bundle size issues at module load time
let monaco: any = null;
let monacoPromise: Promise<any> | null = null;

function loadMonaco(): Promise<any> {
    if (monaco) return Promise.resolve(monaco);
    if (monacoPromise) return monacoPromise;
    monacoPromise = import('monaco-editor').then((m) => {
        monaco = m;
        return m;
    });
    return monacoPromise;
}

function getMonacoLanguage(mimeType: string, filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
    case 'go': return 'go';
    case 'js': case 'jsx': return 'javascript';
    case 'ts': case 'tsx': return 'typescript';
    case 'py': return 'python';
    case 'rb': return 'ruby';
    case 'java': return 'java';
    case 'c': case 'h': return 'c';
    case 'cpp': case 'cc': case 'cxx': return 'cpp';
    case 'rs': return 'rust';
    case 'md': return 'markdown';
    case 'html': case 'htm': return 'html';
    case 'css': return 'css';
    case 'json': return 'json';
    case 'yaml': case 'yml': return 'yaml';
    case 'toml': return 'ini';
    case 'xml': return 'xml';
    case 'sh': case 'bash': return 'shell';
    case 'sql': return 'sql';
    default: return 'plaintext';
    }
}

interface FileViewerProps {
    tabs: Tab[];
    activeTabIndex: number;
    loading: boolean;
    pluginId: string;
    allowWrite: boolean;
    onTabSelect: (index: number) => void;
    onTabClose: (index: number) => void;
    onContentChange: (index: number, content: string) => void;
    onSave: (index: number) => void;
}

function getPluginApiUrl(pluginId: string): string {
    return `/plugins/${pluginId}`;
}

function isImageMime(mime: string): boolean {
    return mime.startsWith('image/');
}

function isPdfMime(mime: string): boolean {
    return mime === 'application/pdf';
}

function isTextMime(mime: string): boolean {
    return (
        mime.startsWith('text/') ||
        mime === 'application/json' ||
        mime === 'application/xml' ||
        mime === 'application/javascript'
    );
}

function isMarkdown(file: FileContent | null): boolean {
    return !!file && file.mimeType === 'text/markdown';
}

// Simple diff: produces unified-like output shown as HTML
function computeDiff(original: string, modified: string): string {
    const origLines = original.split('\n');
    const modLines = modified.split('\n');
    const result: string[] = [];

    let i = 0, j = 0;
    while (i < origLines.length || j < modLines.length) {
        if (i < origLines.length && j < modLines.length && origLines[i] === modLines[j]) {
            result.push(`<span class="diff-ctx"> ${escapeHtml(origLines[i])}</span>`);
            i++; j++;
        } else if (j < modLines.length && (i >= origLines.length || origLines[i] !== modLines[j])) {
            result.push(`<span class="diff-add">+${escapeHtml(modLines[j])}</span>`);
            j++;
        } else {
            result.push(`<span class="diff-del">-${escapeHtml(origLines[i])}</span>`);
            i++;
        }
    }
    return result.join('\n');
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Monaco editor wrapper component
interface MonacoEditorProps {
    value: string;
    language: string;
    readOnly: boolean;
    onChange: (value: string) => void;
}

const MonacoEditor: React.FC<MonacoEditorProps> = ({value, language, readOnly, onChange}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<any>(null);
    const [monacoLoaded, setMonacoLoaded] = useState(false);

    useEffect(() => {
        let disposed = false;
        loadMonaco().then((m) => {
            if (disposed || !containerRef.current) return;
            setMonacoLoaded(true);

            if (editorRef.current) {
                editorRef.current.dispose();
            }

            // Set dark theme
            m.editor.defineTheme('file-viewer-dark', {
                base: 'vs-dark',
                inherit: true,
                rules: [],
                colors: {
                    'editor.background': '#1e1e2e',
                },
            });

            const editor = m.editor.create(containerRef.current, {
                value,
                language,
                theme: 'file-viewer-dark',
                readOnly,
                automaticLayout: true,
                minimap: {enabled: true},
                lineNumbers: 'on',
                folding: true,
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                fontSize: 13,
                fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
            });

            editor.onDidChangeModelContent(() => {
                if (!readOnly) {
                    onChange(editor.getValue());
                }
            });

            editorRef.current = editor;
        });

        return () => {
            disposed = true;
        };
    }, [language, readOnly]); // recreate on language change

    // Update value without recreating editor
    useEffect(() => {
        if (editorRef.current) {
            const currentValue = editorRef.current.getValue();
            if (currentValue !== value) {
                const model = editorRef.current.getModel();
                if (model) {
                    editorRef.current.pushUndoStop();
                    model.pushEditOperations(
                        [],
                        [{range: model.getFullModelRange(), text: value}],
                        () => null,
                    );
                    editorRef.current.pushUndoStop();
                }
            }
        }
    }, [value]);

    // Resize on container change
    useEffect(() => {
        return () => {
            if (editorRef.current) {
                editorRef.current.dispose();
                editorRef.current = null;
            }
        };
    }, []);

    if (!monacoLoaded) {
        return <div className='monaco-loading'>Loading editor...</div>;
    }

    return <div ref={containerRef} className='monaco-container' />;
};

const FileViewer: React.FC<FileViewerProps> = ({
    tabs, activeTabIndex, loading, pluginId, allowWrite,
    onTabSelect, onTabClose, onContentChange, onSave,
}) => {
    const [showDiff, setShowDiff] = useState(false);
    const [showMarkdownPreview, setShowMarkdownPreview] = useState(false);

    const activeTab = tabs[activeTabIndex] || null;
    const file = activeTab?.content || null;

    // Reset diff/preview when switching tabs
    useEffect(() => {
        setShowDiff(false);
        setShowMarkdownPreview(false);
    }, [activeTabIndex]);

    const handleSave = () => {
        if (activeTabIndex >= 0) {
            onSave(activeTabIndex);
        }
    };

    // Keyboard shortcut: Ctrl+S
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (activeTab?.modified) {
                    handleSave();
                }
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [activeTabIndex, activeTab]);

    if (loading && tabs.length === 0) {
        return <div className='file-viewer-loading'>Loading file...</div>;
    }

    if (tabs.length === 0) {
        return (
            <div className='file-viewer-empty'>
                <div className='file-viewer-empty-icon'>📂</div>
                <div>Select a file to view its contents</div>
            </div>
        );
    }

    const downloadUrl = file
        ? `${getPluginApiUrl(pluginId)}/api/v1/download?path=${encodeURIComponent(file.path)}`
        : '';

    // Breadcrumbs from path
    const renderBreadcrumbs = () => {
        if (!file) return null;
        const parts = file.path.split('/').filter(Boolean);
        return (
            <div className='file-viewer-breadcrumbs'>
                {parts.map((part, i) => (
                    <span key={i}>
                        <span className='breadcrumb-sep'>{i > 0 ? ' / ' : ''}</span>
                        <span className={`breadcrumb-part${i === parts.length - 1 ? ' active' : ''}`}>
                            {part}
                        </span>
                    </span>
                ))}
            </div>
        );
    };

    return (
        <div className='file-viewer'>
            {/* Tabs */}
            <div className='file-viewer-tabs'>
                {tabs.map((tab, i) => (
                    <div
                        key={tab.path}
                        className={`file-viewer-tab${i === activeTabIndex ? ' active' : ''}`}
                        onClick={() => onTabSelect(i)}
                        title={tab.path}
                    >
                        <span className='tab-name'>{tab.name}{tab.modified ? ' ●' : ''}</span>
                        <span
                            className='tab-close'
                            onClick={(e) => { e.stopPropagation(); onTabClose(i); }}
                        >×</span>
                    </div>
                ))}
            </div>

            {/* Breadcrumbs */}
            {renderBreadcrumbs()}

            {/* Toolbar */}
            {file && (
                <div className='file-viewer-toolbar'>
                    <div className='file-viewer-toolbar-actions'>
                        {allowWrite && isTextMime(file.mimeType) && (
                            <>
                                <button
                                    onClick={handleSave}
                                    disabled={!activeTab?.modified}
                                    className='btn-primary'
                                >
                                    💾 Save
                                </button>
                                {activeTab?.modified && (
                                    <button
                                        onClick={() => setShowDiff(!showDiff)}
                                        className={showDiff ? 'btn-active' : ''}
                                    >
                                        ± Diff
                                    </button>
                                )}
                            </>
                        )}
                        {isMarkdown(file) && (
                            <button
                                onClick={() => setShowMarkdownPreview(!showMarkdownPreview)}
                                className={showMarkdownPreview ? 'btn-active' : ''}
                            >
                                👁 Preview
                            </button>
                        )}
                        {file && (
                            <a
                                href={downloadUrl}
                                target='_blank'
                                rel='noopener noreferrer'
                                style={{textDecoration: 'none'}}
                            >
                                <button type='button'>⬇ Download</button>
                            </a>
                        )}
                    </div>
                </div>
            )}

            {/* Content */}
            <div className='file-viewer-content'>
                {loading && (
                    <div className='file-viewer-loading-overlay'>Loading...</div>
                )}

                {file && isTextMime(file.mimeType) && (
                    <>
                        {showDiff && activeTab && (
                            <div className='diff-view'>
                                <div className='diff-header'>Changes (vs. saved)</div>
                                <pre
                                    className='diff-content'
                                    dangerouslySetInnerHTML={{
                                        __html: computeDiff(file.content, activeTab.editContent),
                                    }}
                                />
                            </div>
                        )}

                        {showMarkdownPreview && isMarkdown(file) ? (
                            <MarkdownPreview content={activeTab?.editContent || ''} />
                        ) : !showDiff && (
                            <MonacoEditor
                                key={`monaco-${file.path}`}
                                value={activeTab?.editContent || ''}
                                language={getMonacoLanguage(file.mimeType, file.name)}
                                readOnly={!allowWrite}
                                onChange={(val) => onContentChange(activeTabIndex, val)}
                            />
                        )}
                    </>
                )}

                {file && isImageMime(file.mimeType) && (
                    <div className='file-viewer-image'>
                        {file.isBase64 ? (
                            <img src={`data:${file.mimeType};base64,${file.content}`} alt={file.name} />
                        ) : (
                            <img src={downloadUrl} alt={file.name} />
                        )}
                    </div>
                )}

                {file && isPdfMime(file.mimeType) && (
                    <iframe className='file-viewer-pdf' src={downloadUrl} title={file.name} />
                )}

                {file && !isTextMime(file.mimeType) && !isImageMime(file.mimeType) && !isPdfMime(file.mimeType) && (
                    <div className='file-viewer-download'>
                        <a href={downloadUrl} target='_blank' rel='noopener noreferrer'>
                            ⬇️ Download {file.name}
                        </a>
                    </div>
                )}
            </div>
        </div>
    );
};

// Markdown preview — renders markdown as HTML
interface MarkdownPreviewProps {
    content: string;
}

const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({content}) => {
    const [html, setHtml] = useState('');

    useEffect(() => {
        // Simple markdown rendering without external dependency
        // Convert basic markdown to HTML
        let result = content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Code blocks
        result = result.replace(/```(\w*)\n([\s\S]*?)```/gm, '<pre><code class="lang-$1">$2</code></pre>');
        // Inline code
        result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Headers
        result = result.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        result = result.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        result = result.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        // Bold
        result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        // Italic
        result = result.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        // Links
        result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        // Unordered list
        result = result.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
        result = result.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
        // Ordered list
        result = result.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
        // Blockquote
        result = result.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
        // Horizontal rule
        result = result.replace(/^---+$/gm, '<hr/>');
        // Paragraphs (double newline)
        result = result.replace(/\n\n/g, '</p><p>');
        result = '<p>' + result + '</p>';
        // Single newline → br (inside paragraphs)
        result = result.replace(/\n/g, '<br/>');

        setHtml(result);
    }, [content]);

    return (
        <div
            className='markdown-preview'
            dangerouslySetInnerHTML={{__html: html}}
        />
    );
};

export default FileViewer;
