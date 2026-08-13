## Purpose

Lets an MCP client create, inspect, update, check off, backfill, and delete Super Productivity habits (the Habit Tracker's streak-tracked click counters) as part of managing a user's productivity data.

## ADDED Requirements

### Requirement: Create a habit
The system SHALL allow creating a new habit given a title, and SHALL accept optional streak-tracking configuration (icon, whether streaks are tracked, streak mode, minimum daily value, applicable weekdays or weekly frequency). The system SHALL return the new habit's id.

#### Scenario: Create a minimal habit
- **WHEN** a client creates a habit with only a title
- **THEN** the system creates a habit with that title, streak tracking disabled by default, and an empty completion history, and returns its id

#### Scenario: Create a habit with streak tracking on specific weekdays
- **WHEN** a client creates a habit with streak tracking enabled, `streak_mode` set to specific days, and a set of weekdays
- **THEN** the system creates a habit that only counts toward a streak on the specified weekdays

#### Scenario: Create a habit with weekly-frequency streak tracking
- **WHEN** a client creates a habit with streak tracking enabled, `streak_mode` set to weekly frequency, and a target frequency
- **THEN** the system creates a habit whose streak is evaluated against completions-per-week rather than specific days

#### Scenario: Missing title
- **WHEN** a client creates a habit without a title
- **THEN** the system rejects the request with an error, and no habit is created

### Requirement: List habits
The system SHALL allow retrieving all habits. Each returned habit SHALL include its configuration, its per-day completion history, and its currently computed streak length.

#### Scenario: List habits with computed streaks
- **WHEN** a client lists habits
- **THEN** the system returns every habit with a `streak` value computed from its completion history and streak configuration, without requiring the client to perform the computation itself

#### Scenario: No habits exist
- **WHEN** a client lists habits and none exist
- **THEN** the system returns an empty list, not an error

### Requirement: Update a habit
The system SHALL allow updating an existing habit's configuration (title, icon, enabled state, streak-tracking configuration) by id, without requiring the client to resend unrelated fields.

#### Scenario: Partial update
- **WHEN** a client updates only the title of an existing habit
- **THEN** the system changes the title and leaves all other configuration and history untouched

#### Scenario: Update a non-existent habit
- **WHEN** a client updates a habit id that does not exist
- **THEN** the system rejects the request with an error identifying the habit as not found

### Requirement: Check off a habit
The system SHALL allow marking a habit done for a given day (defaulting to today) by incrementing that day's recorded value, mirroring how completing a habit in the Habit Tracker UI increments the day's count rather than overwriting it.

#### Scenario: First check-off of the day
- **WHEN** a client checks off a habit that has no recorded value for the target day
- **THEN** the system records a value of 1 for that day

#### Scenario: Repeated check-off of the day
- **WHEN** a client checks off a habit that already has a recorded value of N for the target day
- **THEN** the system records a value of N + 1 for that day, allowing goal-based habits (e.g. "drink 3 glasses of water") to accumulate

#### Scenario: Check off a non-existent habit
- **WHEN** a client checks off a habit id that does not exist
- **THEN** the system rejects the request with an error identifying the habit as not found

### Requirement: Backfill or correct a habit's value for a specific day
The system SHALL allow a client to set a habit's exact recorded value for a specific past or present day, independent of the habit's current value for that day, to support backfilling missed entries or correcting mistakes.

#### Scenario: Backfill a missed day
- **WHEN** a client sets a habit's value for a past date to 1
- **THEN** the system records that value for that date, and that date becomes eligible to count toward the habit's streak on subsequent streak calculations

#### Scenario: Correct today's value
- **WHEN** a client sets a habit's value for today to 0
- **THEN** the system overwrites any existing value for today with 0, undoing an earlier check-off

#### Scenario: Invalid date format
- **WHEN** a client sets a habit's value using a date that is not in `YYYY-MM-DD` format
- **THEN** the system rejects the request with an error and does not modify the habit

### Requirement: Delete a habit
The system SHALL allow deleting a habit by id, permanently removing its configuration and completion history.

#### Scenario: Delete an existing habit
- **WHEN** a client deletes a habit that exists
- **THEN** the system removes it, and it no longer appears when listing habits

#### Scenario: Delete a non-existent habit
- **WHEN** a client deletes a habit id that does not exist
- **THEN** the system rejects the request with an error identifying the habit as not found

### Requirement: Habit tools scoped to streak-tracked click counters
The system SHALL operate only on habit-shaped entries (click counters intended for streak tracking) and SHALL NOT expose or require clients to manage stopwatch-type or countdown-reminder-type entries, which are a distinct Super Productivity feature sharing the same underlying storage.

#### Scenario: Listing habits excludes non-habit entries
- **WHEN** a client lists habits and the user also has stopwatch-type or countdown-reminder-type entries configured in Super Productivity
- **THEN** the system excludes those non-habit entries from the results

### Requirement: Clear error on unsupported Super Productivity version
The system SHALL detect when the connected Super Productivity instance does not support habit management (an older plugin API lacking the required methods) and SHALL report a clear, actionable error rather than a low-level failure.

#### Scenario: Connected instance predates habit support
- **WHEN** a client calls any habit tool against a Super Productivity instance whose plugin API lacks the required methods
- **THEN** the system returns an error explaining that habit management requires a newer Super Productivity version, instead of an opaque internal error
