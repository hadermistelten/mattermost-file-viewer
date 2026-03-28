import React, {useState, useEffect, useRef} from 'react';
import {FileContent, Tab} from '../types';

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

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

// Simple code editor using textarea with line numbers
const CodeEditor: React.FC<{
    value: string;
    readOnly: boolean;
    onChange: (value: string) => void;
}> = ({value, readOnly, onChange}) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const lineNumbersRef = useRef<HTMLDivElement>(null);
    const lines = value.split('\n');

    const syncScroll = () => {
        if (textareaRef.current && lineNumbersRef.current) {
            lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
        }
    };

    // Handle tab key
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const ta = textareaRef.current;
            if (!ta || readOnly) return;
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const newVal = value.substring(0, start) + '    ' + value.substring(end);
            onChange(newVal);
            // Restore cursor position after React re-render
            requestAnimationFrame(() => {
                ta.selectionStart = ta.selectionEnd = start + 4;
            });
        }
    };

    return (
        <div className='code-editor'>
            <div className='line-numbers' ref={lineNumbersRef}>
                {lines.map((_, i) => (
                    <div key={i} className='line-number'>{i + 1}</div>
                ))}
            </div>
            <textarea
                ref={textareaRef}
                className='code-textarea'
                value={value}
                readOnly={readOnly}
                onChange={(e) => onChange(e.target.value)}
                onScroll={syncScroll}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                autoComplete='off'
                autoCorrect='off'
                autoCapitalize='off'
            />
        </div>
    );
};

// Markdown preview
const MarkdownPreview: React.FC<{content: string}> = ({content}) => {
    const [html, setHtml] = useState('');
    useEffect(() => {
        let r = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        r = r.replace(/```(\w*)\n([\s\S]*?)```/gm, '<pre><code class="lang-$1">$2</code></pre>');
        r = r.replace(/`([^`]+)`/g, '<code>$1</code>');
        r = r.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        r = r.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        r = r.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        r = r.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        r = r.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
        r = r.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
        r = r.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
        r = r.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
        r = r.replace(/^---+$/gm, '<hr/>');
        r = r.replace(/\n\n/g, '</p><p>');
        r = '<p>' + r + '</p>';
        r = r.replace(/\n/g, '<br/>');
        setHtml(r);
    }, [content]);
    return <div className='markdown-preview' dangerouslySetInnerHTML={{__html: html}} />;
};

const FileViewer: React.FC<FileViewerProps> = ({
    tabs, activeTabIndex, loading, pluginId, allowWrite,
    onTabSelect, onTabClose, onContentChange, onSave,
}) => {
    const [showDiff, setShowDiff] = useState(false);
    const [showPreview, setShowPreview] = useState(false);
    const activeTab = tabs[activeTabIndex] || null;
    const file = activeTab?.content || null;

    useEffect(() => { setShowDiff(false); setShowPreview(false); }, [activeTabIndex]);

    const handleSave = () => { if (activeTabIndex >= 0) onSave(activeTabIndex); };

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (activeTab?.modified) handleSave();
            }
        };
        document.addEventListener('keydown', h);
        return () => document.removeEventListener('keydown', h);
    }, [activeTabIndex, activeTab]);

    if (loading && tabs.length === 0) return <div className='file-viewer-loading'>Loading file...</div>;
    if (tabs.length === 0) {
        return (
            <div className='file-viewer-empty'>
                <div className='file-viewer-empty-icon'>📂</div>
                <div>Select a file to view its contents</div>
            </div>
        );
    }

    const downloadUrl = file ? `/plugins/${pluginId}/api/v1/download?path=${encodeURIComponent(file.path)}` : '';

    return (
        <div className='file-viewer'>
            <div className='file-viewer-tabs'>
                {tabs.map((tab, i) => (
                    <div key={tab.path} className={`file-viewer-tab${i === activeTabIndex ? ' active' : ''}`}
                        onClick={() => onTabSelect(i)} title={tab.path}>
                        <span className='tab-name'>{tab.name}{tab.modified ? ' ●' : ''}</span>
                        <span className='tab-close' onClick={(e) => { e.stopPropagation(); onTabClose(i); }}>×</span>
                    </div>
                ))}
            </div>

            {file && (
                <div className='file-viewer-breadcrumbs'>
                    {file.path.split('/').filter(Boolean).map((part, i, arr) => (
                        <span key={i}>
                            {i > 0 && <span className='breadcrumb-sep'> / </span>}
                            <span className={`breadcrumb-part${i === arr.length - 1 ? ' active' : ''}`}>{part}</span>
                        </span>
                    ))}
                </div>
            )}

            {file && (
                <div className='file-viewer-toolbar'>
                    <div className='file-viewer-toolbar-actions'>
                        {allowWrite && isTextMime(file.mimeType) && (
                            <>
                                <button onClick={handleSave} disabled={!activeTab?.modified} className='btn-primary'>💾 Save</button>
                                {activeTab?.modified && (
                                    <button onClick={() => setShowDiff(!showDiff)} className={showDiff ? 'btn-active' : ''}>± Diff</button>
                                )}
                            </>
                        )}
                        {isMarkdown(file) && (
                            <button onClick={() => setShowPreview(!showPreview)} className={showPreview ? 'btn-active' : ''}>👁 Preview</button>
                        )}
                        <a href={downloadUrl} target='_blank' rel='noopener noreferrer' style={{textDecoration: 'none'}}>
                            <button type='button'>⬇ Download</button>
                        </a>
                    </div>
                </div>
            )}

            <div className='file-viewer-content'>
                {loading && <div className='file-viewer-loading-overlay'>Loading...</div>}

                {file && isTextMime(file.mimeType) && (
                    <>
                        {showDiff && activeTab && (
                            <div className='diff-view'>
                                <div className='diff-header'>Changes (vs. saved)</div>
                                <pre className='diff-content' dangerouslySetInnerHTML={{__html: computeDiff(file.content, activeTab.editContent)}} />
                            </div>
                        )}
                        {showPreview && isMarkdown(file) ? (
                            <MarkdownPreview content={activeTab?.editContent || ''} />
                        ) : !showDiff && (
                            <CodeEditor
                                value={activeTab?.editContent || ''}
                                readOnly={!allowWrite}
                                onChange={(val) => onContentChange(activeTabIndex, val)}
                            />
                        )}
                    </>
                )}

                {file && isImageMime(file.mimeType) && (
                    <div className='file-viewer-image'>
                        {file.isBase64
                            ? <img src={`data:${file.mimeType};base64,${file.content}`} alt={file.name} />
                            : <img src={downloadUrl} alt={file.name} />
                        }
                    </div>
                )}

                {file && isPdfMime(file.mimeType) && <iframe className='file-viewer-pdf' src={downloadUrl} title={file.name} />}

                {file && !isTextMime(file.mimeType) && !isImageMime(file.mimeType) && !isPdfMime(file.mimeType) && (
                    <div className='file-viewer-download'>
                        <a href={downloadUrl} target='_blank' rel='noopener noreferrer'>⬇️ Download {file.name}</a>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FileViewer;
