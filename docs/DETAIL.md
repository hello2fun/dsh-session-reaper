# Session reaper

DSH keeps every session forever. Its persistence layer deliberately exposes no deletion API, and archived sessions still occupy disk. This plugin adds the missing capability without patching the host: it moves a session's stored log directory into a trash you control, restores it on request, and frees the image attachments that only that session referenced.

## What you get

### A management panel in the left sidebar

- Lists every session with its title, project directory, and last activity.
- Search by title or path; empty "New session" drafts are hidden unless you ask for them.
- Select rows and delete them together, or delete one row at a time.
- Open a session directly from the panel.
- A trash tab lists deleted entries with restore, permanent delete, and empty-trash actions.

### A delete action in every session row menu

The `⋯` menu of each session gains **Delete session…**, which asks for confirmation and then moves that session to the trash.

### Disk reclamation

Image attachments are content-addressed under `$DSH_HOME/attachments/v1/objects/<sha256-prefix>/<sha256>` and shared by byte equality. Deleting a session collects the attachment ids its log references and removes only the objects that no remaining session references. Identical images used elsewhere survive.

The panel also offers **Collect unused attachments**: it scans every live session and the trash and removes objects nothing references.

## How deletion works

1. The plugin reads the session's attachment references from its stored log.
2. It writes a `meta.json` (title, working directory, original path, deletion time, referenced attachments) and moves the log directory to `$DSH_HOME/deleted-sessions/<batch>/<id>/session`.
3. With attachment collection enabled, it scans every remaining session and deletes unresolvable-or-unreferenced objects.

Restoring moves the log directory back, removes the trash entry, and re-attaches the session to the workspace whose directory matches its recorded working directory.

## Safety rules

- Every HTTP route is an exact route on the authenticated connection channel; only the owner peer reaches it.
- A scan that cannot read any remaining session log aborts attachment collection entirely, because an unreadable log may reference any candidate.
- Objects written in the last 60 seconds are never collected.
- A shared object is never deleted while a remaining session references it.
- Deleting a session whose log is locked by another writer fails with a reason instead of forcing the move.

## Limitations

- The session log itself stays on disk until the trash entry is purged.
- Deleting with image collection enabled makes a later restore of that session keep its text history but lose its images.
- Non-image file attachments (`v1/file-objects`) are outside the collection scope.
- No configuration surface yet: the trash location and the 60-second guard are fixed.
- The panel reflects the session list DSH already exposes; subagent-origin rows are hidden.

## Data locations

| What | Where |
|---|---|
| Trashed session logs | `$DSH_HOME/deleted-sessions/<batch>/<id>/session` |
| Trash metadata | `$DSH_HOME/deleted-sessions/<batch>/<id>/meta.json` |
| Image objects | `$DSH_HOME/attachments/v1/objects/<prefix>/<sha256>` |
| Live session logs | `$DSH_HOME/sessions/<project>/<id>/` |

## Uninstall

Disabling or uninstalling the plugin leaves the trash directory untouched; restore entries through the plugin before removing it, or move the directories back by hand. Purge the trash from the panel first if you want the space back.

## License

MIT
