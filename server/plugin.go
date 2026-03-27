package main

import (
	"net/http"
	"sync"

	"github.com/mattermost/mattermost/server/public/plugin"
)

// Plugin implements the Mattermost plugin interface.
type Plugin struct {
	plugin.MattermostPlugin

	configurationLock sync.RWMutex
	configuration     *configuration

	watcher *FileWatcher
}

func (p *Plugin) OnActivate() error {
	config := p.getConfiguration()

	if config.RootPath != "" {
		watcher, err := NewFileWatcher(p, config.RootPath)
		if err != nil {
			p.API.LogWarn("Failed to start file watcher", "error", err.Error())
		} else {
			p.watcher = watcher
		}
	}

	return nil
}

func (p *Plugin) OnDeactivate() error {
	if p.watcher != nil {
		p.watcher.Stop()
	}
	return nil
}

func (p *Plugin) OnConfigurationChange() error {
	config := new(configuration)
	if err := p.API.LoadPluginConfiguration(config); err != nil {
		return err
	}

	p.setConfiguration(config)

	// Restart watcher with new config
	if p.watcher != nil {
		p.watcher.Stop()
		p.watcher = nil
	}

	if config.RootPath != "" {
		watcher, err := NewFileWatcher(p, config.RootPath)
		if err != nil {
			p.API.LogWarn("Failed to start file watcher", "error", err.Error())
		} else {
			p.watcher = watcher
		}
	}

	return nil
}

// ServeHTTP delegates to the API router.
func (p *Plugin) ServeHTTP(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	p.handleHTTPRequest(w, r)
}

func main() {
	plugin.ClientMain(&Plugin{})
}
