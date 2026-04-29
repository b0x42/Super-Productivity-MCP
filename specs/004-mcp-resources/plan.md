# Implementation Plan: MCP Resources

**Feature**: MCP Resources (Read-Only Context)
**Created**: 2026-04-29
**Source**: [spec.md](spec.md), [data-model.md](data-model.md)

## Implementation Steps

### Step 1: Create `src/resources/index.ts`

Register all four resources with the MCP server. Each resource handler calls `sendCommand` with the appropriate action and filters, then formats the response as JSON text content.

**Resources to register**:
- `sp://projects` → `sendCommand(dirs, 'getProjects', {})`
- `sp://tags` → `sendCommand(dirs, 'getTags', {})`
- `sp://tasks/today` → `sendCommand(dirs, 'getTasks', { filters: { plannedForToday: true } })`
- `sp://tasks/overdue` → `sendCommand(dirs, 'getTasks', { filters: { overdue: true } })`

**Shape functions**: Extract only the fields defined in the data model (strip internal SP state).

### Step 2: Wire resources into `src/server.ts`

Import and call `registerResources(server, dirs)` alongside the existing `registerXxxTools()` calls.

### Step 3: Add unit tests

Create `tests/unit/resources/` with tests verifying:
- Each resource calls the correct IPC action
- Response is shaped correctly (only expected fields)
- IPC errors propagate as resource read errors

### Step 4: Update README

Add a "Resources" section documenting the available URIs and what they provide.

## File Changes

| File | Change |
|------|--------|
| `src/resources/index.ts` | **New** — resource registration |
| `src/server.ts` | Import + call `registerResources` |
| `tests/unit/resources/resources.test.ts` | **New** — unit tests |
| `README.md` | Add Resources section |

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| MCP SDK version doesn't support `registerResource` | Verify API exists in `@modelcontextprotocol/sdk@^1.29.0` before implementing |
| Clients don't read resources automatically | Resources still work on-demand; value is reduced but no harm |
| 2s IPC latency per resource read at startup | Acceptable for v1; future optimization could batch reads or add caching |
