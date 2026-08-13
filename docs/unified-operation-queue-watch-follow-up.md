# Unified operation queue: watch-mode follow-up

The operation queue deliberately does not route automatic watch imports yet. The current watch controller predates the unified queue and has safety gaps that should not be hidden behind the new scheduler:

- It selects from the global import queue, so unrelated manual entries can be swept into an automatic run.
- A declined Housing conflict or failed import can be scheduled again without a newer local save.
- Automatically added rows are not reconciled out when a later parse shows that local and Housing content match.
- Save detection pauses while the overlay is closed, and this behavior has no controller-level tests.
- Export writes can trigger intermediate parses before the export cache and project files have both settled.

A safe watch-mode change should be a separate reviewable PR built on the queue foundation. Its acceptance criteria are:

1. Watch owns an immutable candidate snapshot; it never starts the entire manual queue.
2. Candidate changes debounce into one queued import after the latest parse settles.
3. A save during a watch import requests normal cancellation, waits for cleanup, recomputes candidates, and queues exactly one replacement run.
4. Parse errors, declined Housing conflicts, cancellation, and failures wait for a newer save-driven parse before retrying.
5. Before admission, each candidate is compared again with the latest local parse and Housing knowledge; clean automatic rows are removed.
6. Local and Housing changes are treated as an explicit conflict. Watch may prompt or pause, but never chooses one side or overwrites local files silently.
7. Export-originated file changes are ignored until the export operation and its cache reconciliation finish.
8. The paused-while-overlay-closed limitation remains visible unless save detection is moved to a true background watcher.

Required tests should cover debounce, manual-queue isolation, busy deferral, save-during-run cancellation, every non-success outcome, automatic-row reconciliation, export interaction, loop detection, and overlay pause/resume.
