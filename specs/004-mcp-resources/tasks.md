# Tasks: MCP Resources

**Feature**: MCP Resources (Read-Only Context)
**Created**: 2026-04-29

## Tasks

- [ ] **TASK-001**: Verify `McpServer.registerResource()` API exists in installed SDK version
- [ ] **TASK-002**: Create `src/resources/index.ts` with `registerResources(server, dirs)` function
  - Register `sp://projects` resource
  - Register `sp://tags` resource
  - Register `sp://tasks/today` resource
  - Register `sp://tasks/overdue` resource
  - Add shape functions to extract only context-relevant fields
- [ ] **TASK-003**: Wire `registerResources` into `src/server.ts`
- [ ] **TASK-004**: Add unit tests in `tests/unit/resources/resources.test.ts`
- [ ] **TASK-005**: Update README.md with Resources documentation
- [ ] **TASK-006**: Run build + typecheck + tests to verify
