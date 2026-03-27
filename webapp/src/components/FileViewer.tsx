import React, {useState, useEffect, useCallback} from 'react';
import {FileContent} from '../types';

interface FileViewerProps {
    file: FileContent | null;
    loading: boolean;
    pluginId: string;
    allowWrite: boolean;
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

const FileViewer: React.FC<FileViewerProps> = ({file, loading, pluginId, allowWrite}) => {
    const [editContent, setEditContent] = useState('');
    const [modified, setModified] = useState(false);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (file && !file.isBase64) {
            setEditContent(file.content);
            setModified(false);
            setStatus('');
            setError('');
        }
    }, [file]);

    const handleSave = useCallback(async () => {
        if (!file || saving) {
            return;
        }

        setSaving(true);
        setError('');
        setStatus('');

        try {
            const response = await fetch(
                `${getPluginApiUrl(pluginId)}/api/v1/file?path=${encodeURIComponent(file.path)}`,
                {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({content: editContent}),
                },
            );

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to save');
            }

            setModified(false);
            setStatus('Saved successfully');
            setTimeout(() => setStatus(''), 3000);
        } catch (err: any) {
            setError(err.message || 'Failed to save file');
        } finally {
            setSaving(false);
        }
    }, [file, editContent, pluginId, saving]);

    if (loading) {
        return <div className="file-viewer-loading">Loading file...</div>;
    }

    if (!file) {
        return (
            <div className="file-viewer-loading">
                Select a file to view its contents
            </div>
        );
    }

    const downloadUrl = `${getPluginApiUrl(pluginId)}/api/v1/download?path=${encodeURIComponent(file.path)}`;

    return (
        <div className="file-viewer">
            <div className="file-viewer-toolbar">
                <span className="file-viewer-toolbar-name" title={file.path}>
                    {file.name}
                    {modified ? ' •' : ''}
                </span>
                <div className="file-viewer-toolbar-actions">
                    {allowWrite && isTextMime(file.mimeType) && (
                        <button onClick={handleSave} disabled={saving || !modified}>
                            {saving ? 'Saving...' : 'Save'}
                        </button>
                    )}
                    <a
                        href={downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{textDecoration: 'none'}}
                    >
                        <button className="secondary" type="button">Download</button>
                    </a>
                </div>
            </div>

            <div className="file-viewer-content">
                {isTextMime(file.mimeType) && (
                    <textarea
                        className="file-viewer-editor"
                        value={editContent}
                        onChange={(e) => {
                            setEditContent(e.target.value);
                            setModified(true);
                        }}
                        readOnly={!allowWrite}
                        spellCheck={false}
                    />
                )}

                {isImageMime(file.mimeType) && (
                    <div className="file-viewer-image">
                        {file.isBase64 ? (
                            <img
                                src={`data:${file.mimeType};base64,${file.content}`}
                                alt={file.name}
                            />
                        ) : (
                            <img src={downloadUrl} alt={file.name} />
                        )}
                    </div>
                )}

                {isPdfMime(file.mimeType) && (
                    <iframe
                        className="file-viewer-pdf"
                        src={downloadUrl}
                        title={file.name}
                    />
                )}

                {!isTextMime(file.mimeType) && !isImageMime(file.mimeType) && !isPdfMime(file.mimeType) && (
                    <div className="file-viewer-download">
                        <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
                            ⬇️ Download {file.name}
                        </a>
                    </div>
                )}
            </div>

            {status && <div className="file-viewer-status">{status}</div>}
            {error && <div className="file-viewer-error">{error}</div>}
        </div>
    );
};

export default FileViewer;
