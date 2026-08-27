## Purpose

Every registered MCP tool validates calls against its full declared parameter set — including nested array-item schemas, not just each tool's top-level parameters — so a client that sends a parameter the tool doesn't recognize gets an explicit, actionable error instead of a silently accepted no-op.

## ADDED Requirements

### Requirement: Reject unrecognized parameters
Every registered MCP tool SHALL reject a call containing one or more parameters not declared in that tool's input schema, returning a validation error that identifies the unrecognized parameter's name, rather than silently discarding it and proceeding. This applies both to a tool's top-level parameters and to parameters inside any nested array-item schema the tool declares (e.g. an object inside a `z.array(z.object({...}))` field), since an unrecognized key nested inside such an item is silently dropped the same way a top-level one is.

#### Scenario: Unknown parameter on a tool call
- **WHEN** a client calls a registered tool with a parameter name not present in that tool's schema
- **THEN** the call fails with a validation error naming the unrecognized parameter, and no state is modified

#### Scenario: Unknown parameter nested inside an array-item parameter
- **WHEN** a client calls a registered tool whose schema includes an array-of-objects parameter, and one array item includes a key not declared on that item's schema
- **THEN** the call fails with a validation error naming the unrecognized parameter, and no state is modified

#### Scenario: Known parameters still accepted
- **WHEN** a client calls a tool using only parameters declared in that tool's schema (including within nested array items)
- **THEN** the call is validated and processed normally
