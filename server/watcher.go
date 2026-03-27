package main

import (
	"os"
	"path/filepath"

	"github.com/fsnotify/fsnotify"
	"github.com/mattermost/mattermost/server/public/model"
)

// FileWatcher watches a directory for changes and notifies connected clients.
type FileWatcher struct {
	watcher *fsnotify.Watcher
	plugin  *Plugin
	done    chan struct{}
}

// NewFileWatcher creates and starts a new file system watcher.
func NewFileWatcher(p *Plugin, rootPath string) (*FileWatcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	fw := &FileWatcher{
		watcher: w,
		plugin:  p,
		done:    make(chan struct{}),
	}

	// Add root path and all subdirectories
	err = filepath.Walk(rootPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			name := filepath.Base(path)
			if len(name) > 0 && name[0] == '.' {
				return filepath.SkipDir
			}
			return w.Add(path)
		}
		return nil
	})

	if err != nil {
		w.Close()
		return nil, err
	}

	go fw.run()

	return fw, nil
}

func (fw *FileWatcher) run() {
	for {
		select {
		case event, ok := <-fw.watcher.Events:
			if !ok {
				return
			}

			if event.Has(fsnotify.Create) || event.Has(fsnotify.Write) ||
				event.Has(fsnotify.Remove) || event.Has(fsnotify.Rename) {

				config := fw.plugin.getConfiguration()
				rootAbs, err := filepath.Abs(config.RootPath)
				if err != nil {
					continue
				}

				relPath, err := filepath.Rel(rootAbs, event.Name)
				if err != nil {
					relPath = event.Name
				}

				fw.plugin.API.PublishWebSocketEvent(
					"file_viewer_changed",
					map[string]interface{}{
						"path":  relPath,
						"event": event.Op.String(),
					},
					&model.WebsocketBroadcast{},
				)

				// If a new directory is created, add it to the watcher
				if event.Has(fsnotify.Create) {
					fw.watcher.Add(event.Name)
				}
			}

		case _, ok := <-fw.watcher.Errors:
			if !ok {
				return
			}

		case <-fw.done:
			return
		}
	}
}

// Stop stops the file watcher.
func (fw *FileWatcher) Stop() {
	close(fw.done)
	fw.watcher.Close()
}
