## 1. Implementation

- [x] 1.1 Add optional `folder_id` (`z.string().nullable().optional()`) to `create_project` inputSchema (src/tools/projects.ts); reject empty/whitespace-only string as error; map non-empty string or explicit `null` to `data.folderId`, omit from `data` when undefined
- [x] 1.2 Add optional `folder_id` (`z.string().nullable().optional()`) to `update_project` inputSchema (src/tools/projects.ts); reject empty/whitespace-only string as error; map non-empty string or explicit `null` to `data.folderId`, omit from `data` when undefined so the field is left untouched
- [x] 1.3 Update `create_project` and `update_project` tool `description` strings with the folder-ID-discovery caveat (no folder-listing method exists; `folder_id` must come from the Super Productivity UI) and document `null` as the clear-folder value

## 2. Tests

- [x] 2.1 Add/update unit tests in tests/unit/tools/projects.test.ts covering: `create_project` with `folder_id`, `update_project` with `folder_id`, `update_project` omitting `folder_id` leaves `data.folderId` unset, `update_project` with `folder_id: null` clears it (`data.folderId === null`), and empty/whitespace-only `folder_id` returns an error on both tools
- [x] 2.2 Run `npm run typecheck` and `npm test`

## 3. Verification

- [x] 3.1 Run `openspec validate add-project-folder-id --strict` and fix any reported issues
