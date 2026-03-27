package main

import "strings"

// configuration captures the plugin's external configuration.
type configuration struct {
	RootPath          string `json:"RootPath"`
	AllowedExtensions string `json:"AllowedExtensions"`
	AllowWrite        bool   `json:"AllowWrite"`
}

func (c *configuration) getAllowedExtensions() []string {
	if c.AllowedExtensions == "" {
		return nil
	}
	parts := strings.Split(c.AllowedExtensions, ",")
	result := make([]string, 0, len(parts))
	for _, p := range parts {
		ext := strings.TrimSpace(p)
		if ext != "" {
			if !strings.HasPrefix(ext, ".") {
				ext = "." + ext
			}
			result = append(result, strings.ToLower(ext))
		}
	}
	return result
}

func (c *configuration) isExtensionAllowed(ext string) bool {
	allowed := c.getAllowedExtensions()
	if len(allowed) == 0 {
		return true
	}
	ext = strings.ToLower(ext)
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	for _, a := range allowed {
		if a == ext {
			return true
		}
	}
	return false
}

func (p *Plugin) getConfiguration() *configuration {
	p.configurationLock.RLock()
	defer p.configurationLock.RUnlock()

	if p.configuration == nil {
		return &configuration{}
	}
	return p.configuration
}

func (p *Plugin) setConfiguration(config *configuration) {
	p.configurationLock.Lock()
	defer p.configurationLock.Unlock()
	p.configuration = config
}
