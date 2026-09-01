# Super-Productivity-MCP
#
# A thin wrapper over the npm scripts, not a replacement for them.
# .github/workflows/ci.yml and prepublishOnly both invoke the npm scripts
# directly, so reimplementing the build here would let the two drift and stop
# CI from testing what you run locally. Every target below shells out.
#
# What make adds is dependency tracking: dist/index.js and dist/plugin.zip are
# real file targets, so an unchanged tree rebuilds nothing.

SHELL := /bin/bash

# Overridable: SCOPE=local make mcp-add
MCP_NAME ?= super-productivity
SCOPE    ?= user

SERVER_SRC := $(shell find src -type f -name '*.ts' 2>/dev/null)
PLUGIN_SRC := $(wildcard plugin/*) scripts/build-plugin.mjs

.DEFAULT_GOAL := build
.PHONY: build install test lint typecheck verify mcp-add mcp-remove clean

## Build both artifacts
build: dist/index.js dist/plugin.zip

## MCP server bundle
dist/index.js: $(SERVER_SRC) tsup.config.ts tsconfig.json | node_modules
	npm run build:server

## SP plugin bundle. The pane's JS is inlined into index.html by the build
## script — SP serves only index.html to the iframe, so a separate .js file
## in the zip is never fetched.
dist/plugin.zip: $(PLUGIN_SRC) | node_modules
	npm run build:plugin

## npm ci is driven by the lockfile; touch so make sees the dir as up to date
node_modules: package-lock.json
	npm ci
	@touch node_modules

install: node_modules

test lint typecheck: | node_modules
	npm run $@

## The pre-commit gate
verify: typecheck lint test

## Register the server with Claude Code, pointing at this checkout's build
mcp-add: dist/index.js
	claude mcp add -s $(SCOPE) $(MCP_NAME) -- node $(CURDIR)/dist/index.js
	@echo
	@echo "Registered '$(MCP_NAME)' ($(SCOPE) scope) -> $(CURDIR)/dist/index.js"
	@echo
	@echo "Claude Code loads MCP servers at startup, and a running server keeps"
	@echo "the code it was spawned with. After this — and after every rebuild —"
	@echo "reconnect it with /mcp, or restart the session (claude --continue)."
	@echo "Super Productivity also needs dist/plugin.zip uploaded in"
	@echo "Settings -> Plugins, with Node execution allowed."

mcp-remove:
	claude mcp remove -s $(SCOPE) $(MCP_NAME)

clean:
	rm -rf dist
