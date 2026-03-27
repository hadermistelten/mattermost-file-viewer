package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// FileNode represents a file or directory in the tree.
type FileNode struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	IsDir    bool       `json:"isDir"`
	Size     int64      `json:"size,omitempty"`
	Children []FileNode `json:"children,omitempty"`
}

// FileContent represents the content of a file.
type FileContent struct {
	Path     string `json:"path"`
	Name     string `json:"name"`
	Content  string `json:"content"`
	MimeType string `json:"mimeType"`
	IsBase64 bool   `json:"isBase64"`
	Size     int64  `json:"size"`
}

func (p *Plugin) handleHTTPRequest(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	switch {
	case path == "/api/v1/tree" && r.Method == http.MethodGet:
		p.handleGetTree(w, r)
	case path == "/api/v1/file" && r.Method == http.MethodGet:
		p.handleGetFile(w, r)
	case path == "/api/v1/file" && r.Method == http.MethodPut:
		p.handlePutFile(w, r)
	case path == "/api/v1/download" && r.Method == http.MethodGet:
		p.handleDownload(w, r)
	default:
		http.NotFound(w, r)
	}
}

// validatePath ensures the requested path is within the configured RootPath.
// Returns the absolute resolved path or an error.
func (p *Plugin) validatePath(relativePath string) (string, error) {
	config := p.getConfiguration()
	if config.RootPath == "" {
		return "", fmt.Errorf("RootPath is not configured")
	}

	rootAbs, err := filepath.Abs(config.RootPath)
	if err != nil {
		return "", fmt.Errorf("invalid RootPath: %w", err)
	}

	// Clean and resolve the relative path
	cleaned := filepath.Clean(relativePath)
	if filepath.IsAbs(cleaned) {
		return "", fmt.Errorf("absolute paths are not allowed")
	}

	fullPath := filepath.Join(rootAbs, cleaned)
	resolvedPath, err := filepath.Abs(fullPath)
	if err != nil {
		return "", fmt.Errorf("unable to resolve path: %w", err)
	}

	// Ensure the resolved path is within the root
	if !strings.HasPrefix(resolvedPath, rootAbs+string(filepath.Separator)) && resolvedPath != rootAbs {
		return "", fmt.Errorf("path traversal detected")
	}

	return resolvedPath, nil
}

func (p *Plugin) handleGetTree(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	if config.RootPath == "" {
		http.Error(w, `{"error":"RootPath not configured"}`, http.StatusBadRequest)
		return
	}

	rootAbs, err := filepath.Abs(config.RootPath)
	if err != nil {
		http.Error(w, `{"error":"Invalid RootPath"}`, http.StatusInternalServerError)
		return
	}

	tree, err := p.buildTree(rootAbs, rootAbs, config)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tree)
}

func (p *Plugin) buildTree(currentPath, rootPath string, config *configuration) ([]FileNode, error) {
	entries, err := os.ReadDir(currentPath)
	if err != nil {
		return nil, err
	}

	nodes := make([]FileNode, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()

		// Skip hidden files/directories
		if strings.HasPrefix(name, ".") {
			continue
		}

		fullPath := filepath.Join(currentPath, name)
		relPath, err := filepath.Rel(rootPath, fullPath)
		if err != nil {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		node := FileNode{
			Name:  name,
			Path:  relPath,
			IsDir: entry.IsDir(),
			Size:  info.Size(),
		}

		if entry.IsDir() {
			children, err := p.buildTree(fullPath, rootPath, config)
			if err == nil {
				node.Children = children
			}
		} else {
			ext := filepath.Ext(name)
			if !config.isExtensionAllowed(ext) {
				continue
			}
		}

		nodes = append(nodes, node)
	}

	return nodes, nil
}

func (p *Plugin) handleGetFile(w http.ResponseWriter, r *http.Request) {
	relativePath := r.URL.Query().Get("path")
	if relativePath == "" {
		http.Error(w, `{"error":"path parameter is required"}`, http.StatusBadRequest)
		return
	}

	absPath, err := p.validatePath(relativePath)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusForbidden)
		return
	}

	info, err := os.Stat(absPath)
	if err != nil {
		http.Error(w, `{"error":"file not found"}`, http.StatusNotFound)
		return
	}

	if info.IsDir() {
		http.Error(w, `{"error":"path is a directory"}`, http.StatusBadRequest)
		return
	}

	config := p.getConfiguration()
	ext := filepath.Ext(absPath)
	if !config.isExtensionAllowed(ext) {
		http.Error(w, `{"error":"file extension not allowed"}`, http.StatusForbidden)
		return
	}

	data, err := os.ReadFile(absPath)
	if err != nil {
		http.Error(w, `{"error":"unable to read file"}`, http.StatusInternalServerError)
		return
	}

	mimeType := detectMimeType(ext)
	isBinary := isBinaryContent(data)

	fc := FileContent{
		Path:     relativePath,
		Name:     filepath.Base(absPath),
		MimeType: mimeType,
		Size:     info.Size(),
	}

	if isBinary {
		fc.Content = base64.StdEncoding.EncodeToString(data)
		fc.IsBase64 = true
	} else {
		fc.Content = string(data)
		fc.IsBase64 = false
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(fc)
}

func (p *Plugin) handlePutFile(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	if !config.AllowWrite {
		http.Error(w, `{"error":"write access is disabled"}`, http.StatusForbidden)
		return
	}

	relativePath := r.URL.Query().Get("path")
	if relativePath == "" {
		http.Error(w, `{"error":"path parameter is required"}`, http.StatusBadRequest)
		return
	}

	absPath, err := p.validatePath(relativePath)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusForbidden)
		return
	}

	var body struct {
		Content string `json:"content"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if err := os.WriteFile(absPath, []byte(body.Content), 0644); err != nil {
		http.Error(w, `{"error":"unable to write file"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (p *Plugin) handleDownload(w http.ResponseWriter, r *http.Request) {
	relativePath := r.URL.Query().Get("path")
	if relativePath == "" {
		http.Error(w, `{"error":"path parameter is required"}`, http.StatusBadRequest)
		return
	}

	absPath, err := p.validatePath(relativePath)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusForbidden)
		return
	}

	info, err := os.Stat(absPath)
	if err != nil {
		http.Error(w, `{"error":"file not found"}`, http.StatusNotFound)
		return
	}

	if info.IsDir() {
		http.Error(w, `{"error":"cannot download a directory"}`, http.StatusBadRequest)
		return
	}

	file, err := os.Open(absPath)
	if err != nil {
		http.Error(w, `{"error":"unable to open file"}`, http.StatusInternalServerError)
		return
	}
	defer file.Close()

	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filepath.Base(absPath)))
	w.Header().Set("Content-Type", "application/octet-stream")
	io.Copy(w, file)
}

func detectMimeType(ext string) string {
	switch strings.ToLower(ext) {
	case ".go":
		return "text/x-go"
	case ".js":
		return "text/javascript"
	case ".ts", ".tsx":
		return "text/typescript"
	case ".py":
		return "text/x-python"
	case ".rb":
		return "text/x-ruby"
	case ".java":
		return "text/x-java"
	case ".c", ".h":
		return "text/x-c"
	case ".cpp", ".cc", ".cxx":
		return "text/x-c++src"
	case ".rs":
		return "text/x-rust"
	case ".md":
		return "text/markdown"
	case ".html", ".htm":
		return "text/html"
	case ".css":
		return "text/css"
	case ".json":
		return "application/json"
	case ".yaml", ".yml":
		return "text/yaml"
	case ".toml":
		return "text/toml"
	case ".xml":
		return "text/xml"
	case ".txt":
		return "text/plain"
	case ".sh", ".bash":
		return "text/x-shellscript"
	case ".sql":
		return "text/x-sql"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".svg":
		return "image/svg+xml"
	case ".webp":
		return "image/webp"
	case ".pdf":
		return "application/pdf"
	case ".zip":
		return "application/zip"
	case ".tar":
		return "application/x-tar"
	case ".gz":
		return "application/gzip"
	default:
		return "application/octet-stream"
	}
}

func isBinaryContent(data []byte) bool {
	// Check first 8KB for null bytes
	checkLen := len(data)
	if checkLen > 8192 {
		checkLen = 8192
	}
	for i := 0; i < checkLen; i++ {
		if data[i] == 0 {
			return true
		}
	}
	return false
}
