PLUGIN_ID = com.brokk-sindre.file-viewer
PLUGIN_VERSION = 1.0.0
BUNDLE_NAME = $(PLUGIN_ID)-$(PLUGIN_VERSION).tar.gz

GO ?= go
NPM ?= npm

GOFLAGS ?= -trimpath
LDFLAGS ?= -s -w

SERVER_DIR = server
WEBAPP_DIR = webapp
DIST_DIR = dist

# Detect OS and arch
GOOS ?= $(shell $(GO) env GOOS)
GOARCH ?= $(shell $(GO) env GOARCH)

.PHONY: all server webapp bundle clean

all: server webapp bundle

## Server build
server:
	@echo "Building server plugin for $(GOOS)/$(GOARCH)..."
	@mkdir -p $(SERVER_DIR)/dist
	cd $(SERVER_DIR) && CGO_ENABLED=0 $(GO) build $(GOFLAGS) -ldflags '$(LDFLAGS)' -o dist/plugin-$(GOOS)-$(GOARCH) .

server-all:
	@echo "Building server plugin for all platforms..."
	@mkdir -p $(SERVER_DIR)/dist
	cd $(SERVER_DIR) && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 $(GO) build $(GOFLAGS) -ldflags '$(LDFLAGS)' -o dist/plugin-linux-amd64 .
	cd $(SERVER_DIR) && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 $(GO) build $(GOFLAGS) -ldflags '$(LDFLAGS)' -o dist/plugin-linux-arm64 .
	cd $(SERVER_DIR) && CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 $(GO) build $(GOFLAGS) -ldflags '$(LDFLAGS)' -o dist/plugin-darwin-amd64 .
	cd $(SERVER_DIR) && CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 $(GO) build $(GOFLAGS) -ldflags '$(LDFLAGS)' -o dist/plugin-darwin-arm64 .

## Webapp build
webapp:
	@echo "Building webapp..."
	cd $(WEBAPP_DIR) && $(NPM) install && $(NPM) run build

## Bundle into .tar.gz
bundle:
	@echo "Creating plugin bundle..."
	@rm -rf $(DIST_DIR)
	@mkdir -p $(DIST_DIR)/$(PLUGIN_ID)/server/dist
	@mkdir -p $(DIST_DIR)/$(PLUGIN_ID)/webapp/dist
	@mkdir -p $(DIST_DIR)/$(PLUGIN_ID)/assets
	@cp plugin.json $(DIST_DIR)/$(PLUGIN_ID)/
	@cp -r $(SERVER_DIR)/dist/* $(DIST_DIR)/$(PLUGIN_ID)/server/dist/ 2>/dev/null || true
	@cp -r $(WEBAPP_DIR)/dist/* $(DIST_DIR)/$(PLUGIN_ID)/webapp/dist/ 2>/dev/null || true
	@cp assets/icon.svg $(DIST_DIR)/$(PLUGIN_ID)/assets/ 2>/dev/null || true
	cd $(DIST_DIR) && tar -czf ../$(BUNDLE_NAME) $(PLUGIN_ID)
	@echo "Plugin bundle created: $(BUNDLE_NAME)"

## Clean
clean:
	@rm -rf $(DIST_DIR)
	@rm -rf $(SERVER_DIR)/dist
	@rm -rf $(WEBAPP_DIR)/dist
	@rm -rf $(WEBAPP_DIR)/node_modules
	@rm -f $(BUNDLE_NAME)
