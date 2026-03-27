package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const maxFileSize = 10 * 1024 * 1024 // 10 MB

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

// SearchResult represents a grep result.
type SearchResult struct {
	Path    string `json:"path"`
	Line    int    `json:"line"`
	Content string `json:"content"`
}

// ConfigResponse returns public plugin config.
type ConfigResponse struct {
	AllowWrite bool `json:"allowWrite"`
}

// AuditEntry is a single audit log entry.
type AuditEntry struct {
	Time   string `json:"time"`
	User   string `json:"user"`
	Action string `json:"action"`
	Path   string `json:"path"`
}

func (p *Plugin) handleHTTPRequest(w http.ResponseWriter, r *http.Request) {
	// CORS for local dev
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	path := r.URL.Path

	switch {
	case path == "/api/v1/tree" && r.Method == http.MethodGet:
		p.handleGetTree(w, r)
	case path == "/api/v1/file" && r.Method == http.MethodGet:
		p.handleGetFile(w, r)
	case path == "/api/v1/file" && r.Method == http.MethodPut:
		p.handlePutFile(w, r)
	case path == "/api/v1/file" && r.Method == http.MethodPost:
		p.handleCreateFile(w, r)
	case path == "/api/v1/file" && r.Method == http.MethodDelete:
		p.handleDeleteFile(w, r)
	case path == "/api/v1/rename" && r.Method == http.MethodPost:
		p.handleRenameFile(w, r)
	case path == "/api/v1/mkdir" && r.Method == http.MethodPost:
		p.handleMkdir(w, r)
	case path == "/api/v1/upload" && r.Method == http.MethodPost:
		p.handleUpload(w, r)
	case path == "/api/v1/search" && r.Method == http.MethodGet:
		p.handleSearch(w, r)
	case path == "/api/v1/config" && r.Method == http.MethodGet:
		p.handleGetConfig(w, r)
	case path == "/api/v1/download" && r.Method == http.MethodGet:
		p.handleDownload(w, r)
	default:
		http.NotFound(w, r)
	}
}

// validatePath ensures the requested path is within the configured RootPath.
// Resolves symlinks to prevent escaping the root.
func (p *Plugin) validatePath(relativePath string) (string, error) {
	config := p.getConfiguration()
	if config.RootPath == "" {
		return "", fmt.Errorf("RootPath is not configured")
	}

	rootAbs, err := filepath.Abs(config.RootPath)
	if err != nil {
		return "", fmt.Errorf("invalid RootPath: %w", err)
	}

	// Resolve symlinks on root
	rootReal, err := filepath.EvalSymlinks(rootAbs)
	if err != nil {
		return "", fmt.Errorf("cannot resolve RootPath: %w", err)
	}

	// Clean and resolve the relative path
	cleaned := filepath.Clean(relativePath)
	if filepath.IsAbs(cleaned) {
		return "", fmt.Errorf("absolute paths are not allowed")
	}

	fullPath := filepath.Join(rootReal, cleaned)

	// Resolve symlinks on the target path
	resolvedPath, err := filepath.EvalSymlinks(fullPath)
	if err != nil {
		// File might not exist yet (for write), fall back to Abs
		resolvedPath, err = filepath.Abs(fullPath)
		if err != nil {
			return "", fmt.Errorf("unable to resolve path: %w", err)
		}
	}

	// Ensure the resolved path is within the root
	if !strings.HasPrefix(resolvedPath, rootReal+string(filepath.Separator)) && resolvedPath != rootReal {
		return "", fmt.Errorf("path traversal detected")
	}

	return resolvedPath, nil
}

// getUserFromRequest extracts the Mattermost user ID from request.
func (p *Plugin) getUserFromRequest(r *http.Request) string {
	// Mattermost sets X-Mattermost-User-Id on plugin requests
	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		userID = "unknown"
	}
	return userID
}

// auditLog writes an audit entry to the configured root path's .audit.log file.
func (p *Plugin) auditLog(userID, action, relPath string) {
	config := p.getConfiguration()
	if config.RootPath == "" {
		return
	}
	entry := AuditEntry{
		Time:   time.Now().UTC().Format(time.RFC3339),
		User:   userID,
		Action: action,
		Path:   relPath,
	}
	data, _ := json.Marshal(entry)
	logPath := filepath.Join(config.RootPath, ".file-viewer-audit.log")
	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		p.API.LogWarn("audit log write failed", "error", err.Error())
		return
	}
	defer f.Close()
	f.Write(data)
	f.WriteString("\n")
}

func (p *Plugin) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ConfigResponse{AllowWrite: config.AllowWrite})
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

	// Support lazy loading: if ?path= is given, list only that subdir (one level)
	subPath := r.URL.Query().Get("path")
	targetPath := rootAbs
	if subPath != "" {
		absSubPath, err := p.validatePath(subPath)
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusForbidden)
			return
		}
		targetPath = absSubPath
	}

	tree, err := p.buildTree(targetPath, rootAbs, config, 0)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tree)
}

const maxTreeDepth = 1 // lazy: only one level deep per request

func (p *Plugin) buildTree(currentPath, rootPath string, config *configuration, depth int) ([]FileNode, error) {
	if depth > maxTreeDepth {
		return nil, nil
	}

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

		// Skip node_modules, __pycache__, etc.
		if entry.IsDir() && (name == "node_modules" || name == "__pycache__" || name == "vendor" || name == "dist") {
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
			// For lazy loading: do NOT recurse into subdirs, mark as dir only
			// The client will fetch children on expand
			node.Children = nil
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

	if info.Size() > maxFileSize {
		http.Error(w, `{"error":"file too large (max 10MB), use download instead"}`, http.StatusRequestEntityTooLarge)
		return
	}

	config := p.getConfiguration()
	ext := filepath.Ext(absPath)
	if !config.isExtensionAllowed(ext) {
		http.Error(w, `{"error":"file extension not allowed"}`, http.StatusForbidden)
		return
	}

	file, err := os.Open(absPath)
	if err != nil {
		http.Error(w, `{"error":"unable to open file"}`, http.StatusInternalServerError)
		return
	}
	defer file.Close()

	// Read first 8KB to detect binary
	header := make([]byte, 8192)
	n, _ := file.Read(header)
	header = header[:n]
	isBinary := isBinaryContent(header)
	file.Seek(0, 0)

	mimeType := detectMimeType(ext)

	w.Header().Set("Content-Type", "application/json")

	// Stream JSON response — no full file in memory
	fmt.Fprintf(w, `{"path":%q,"name":%q,"mimeType":%q,"isBase64":%v,"size":%d,"content":"`,
		relativePath, filepath.Base(absPath), mimeType, isBinary, info.Size())

	if isBinary {
		encoder := base64.NewEncoder(base64.StdEncoding, w)
		io.Copy(encoder, file)
		encoder.Close()
	} else {
		buf := make([]byte, 32*1024)
		for {
			nr, readErr := file.Read(buf)
			if nr > 0 {
				s := string(buf[:nr])
				escaped, _ := json.Marshal(s)
				// Strip surrounding quotes from json.Marshal
				w.Write(escaped[1 : len(escaped)-1])
			}
			if readErr != nil {
				break
			}
		}
	}

	fmt.Fprint(w, `"}`)
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

	// Limit request body size
	r.Body = http.MaxBytesReader(w, r.Body, maxFileSize)

	var body struct {
		Content string `json:"content"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body or too large"}`, http.StatusBadRequest)
		return
	}

	if err := os.WriteFile(absPath, []byte(body.Content), 0644); err != nil {
		http.Error(w, `{"error":"unable to write file"}`, http.StatusInternalServerError)
		return
	}

	userID := p.getUserFromRequest(r)
	p.auditLog(userID, "write", relativePath)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (p *Plugin) handleCreateFile(w http.ResponseWriter, r *http.Request) {
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

	// Check it doesn't already exist
	if _, err := os.Stat(absPath); err == nil {
		http.Error(w, `{"error":"file already exists"}`, http.StatusConflict)
		return
	}

	// Ensure parent dir exists
	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		http.Error(w, `{"error":"unable to create parent directory"}`, http.StatusInternalServerError)
		return
	}

	if err := os.WriteFile(absPath, []byte(""), 0644); err != nil {
		http.Error(w, `{"error":"unable to create file"}`, http.StatusInternalServerError)
		return
	}

	userID := p.getUserFromRequest(r)
	p.auditLog(userID, "create", relativePath)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok", "path": relativePath})
}

func (p *Plugin) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
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

	if err := os.RemoveAll(absPath); err != nil {
		http.Error(w, `{"error":"unable to delete"}`, http.StatusInternalServerError)
		return
	}

	userID := p.getUserFromRequest(r)
	p.auditLog(userID, "delete", relativePath)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (p *Plugin) handleRenameFile(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	if !config.AllowWrite {
		http.Error(w, `{"error":"write access is disabled"}`, http.StatusForbidden)
		return
	}

	var body struct {
		OldPath string `json:"oldPath"`
		NewPath string `json:"newPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	absOld, err := p.validatePath(body.OldPath)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusForbidden)
		return
	}
	absNew, err := p.validatePath(body.NewPath)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusForbidden)
		return
	}

	if err := os.Rename(absOld, absNew); err != nil {
		http.Error(w, `{"error":"unable to rename"}`, http.StatusInternalServerError)
		return
	}

	userID := p.getUserFromRequest(r)
	p.auditLog(userID, "rename:"+body.OldPath+"->"+body.NewPath, body.NewPath)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (p *Plugin) handleMkdir(w http.ResponseWriter, r *http.Request) {
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

	if err := os.MkdirAll(absPath, 0755); err != nil {
		http.Error(w, `{"error":"unable to create directory"}`, http.StatusInternalServerError)
		return
	}

	userID := p.getUserFromRequest(r)
	p.auditLog(userID, "mkdir", relativePath)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (p *Plugin) handleUpload(w http.ResponseWriter, r *http.Request) {
	config := p.getConfiguration()
	if !config.AllowWrite {
		http.Error(w, `{"error":"write access is disabled"}`, http.StatusForbidden)
		return
	}

	// Max 10MB for upload
	r.ParseMultipartForm(maxFileSize)

	dirPath := r.FormValue("dir")
	if dirPath == "" {
		dirPath = "."
	}

	absDir, err := p.validatePath(dirPath)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusForbidden)
		return
	}

	uploadedFiles := []string{}
	files := r.MultipartForm.File["files"]
	for _, fileHeader := range files {
		filename := filepath.Base(fileHeader.Filename)
		destPath := filepath.Join(absDir, filename)

		// Validate the destination is still in root
		rootAbs, _ := filepath.Abs(config.RootPath)
		rootReal, _ := filepath.EvalSymlinks(rootAbs)
		destAbs, _ := filepath.Abs(destPath)
		if !strings.HasPrefix(destAbs, rootReal+string(filepath.Separator)) {
			continue
		}

		src, err := fileHeader.Open()
		if err != nil {
			continue
		}

		dst, err := os.Create(destPath)
		if err != nil {
			src.Close()
			continue
		}

		io.Copy(dst, src)
		src.Close()
		dst.Close()

		relPath, _ := filepath.Rel(rootAbs, destPath)
		uploadedFiles = append(uploadedFiles, relPath)
	}

	userID := p.getUserFromRequest(r)
	for _, f := range uploadedFiles {
		p.auditLog(userID, "upload", f)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "files": uploadedFiles})
}

func (p *Plugin) handleSearch(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		http.Error(w, `{"error":"q parameter is required"}`, http.StatusBadRequest)
		return
	}

	searchType := r.URL.Query().Get("type") // "name" or "content"
	if searchType == "" {
		searchType = "content"
	}

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

	results := []SearchResult{}

	if searchType == "name" {
		// Walk the tree and match filenames
		filepath.Walk(rootAbs, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			name := info.Name()
			if strings.HasPrefix(name, ".") {
				if info.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if info.IsDir() && (name == "node_modules" || name == "__pycache__" || name == "vendor" || name == "dist") {
				return filepath.SkipDir
			}
			if !info.IsDir() && strings.Contains(strings.ToLower(name), strings.ToLower(query)) {
				relPath, _ := filepath.Rel(rootAbs, path)
				results = append(results, SearchResult{Path: relPath, Line: 0, Content: name})
			}
			return nil
		})
	} else {
		// Use grep for content search
		cmd := exec.Command("grep", "-r", "-n", "-i", "--include=*",
			"--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=__pycache__",
			"--exclude-dir=vendor", "--exclude-dir=dist",
			"-l", // only filenames first to check
			query, rootAbs)
		// Actually do line-level grep
		cmd = exec.Command("grep", "-r", "-n", "-i",
			"--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=__pycache__",
			"--exclude-dir=vendor", "--exclude-dir=dist",
			"--max-count=5", // max 5 matches per file
			query, rootAbs)
		cmd.Env = os.Environ()

		output, err := cmd.Output()
		if err != nil && len(output) == 0 {
			// No results or grep error
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(results)
			return
		}

		lines := strings.Split(string(output), "\n")
		for _, line := range lines {
			if line == "" {
				continue
			}
			// Format: /abs/path/file:linenum:content
			parts := strings.SplitN(line, ":", 3)
			if len(parts) < 3 {
				continue
			}
			relPath, _ := filepath.Rel(rootAbs, parts[0])
			lineNum := 0
			fmt.Sscanf(parts[1], "%d", &lineNum)
			content := strings.TrimSpace(parts[2])
			if len(content) > 200 {
				content = content[:200]
			}
			results = append(results, SearchResult{Path: relPath, Line: lineNum, Content: content})
			if len(results) >= 100 {
				break
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
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
	case ".jsx":
		return "text/javascript"
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
	for i := 0; i < len(data); i++ {
		if data[i] == 0 {
			return true
		}
	}
	return false
}
