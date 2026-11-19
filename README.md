# dsh-session-reaper

**Recoverable session deletion for DeepSeek Harness.**

DSH keeps every session forever: the persistence layer exposes no deletion API, and archived sessions still occupy disk. `dsh-session-reaper` adds what is missing — a sidebar manager that moves sessions to a trash you can restore from, and reclaims the image attachments those sessions referenced.

- **Trash, not blind deletion** — deleting moves the session log directory to `$DSH_HOME/deleted-sessions/<batch>/<id>/`; restoring moves it back and re-attaches the session to its workspace.
- **Reclaims disk** — image attachments are content-addressed under `$DSH_HOME/attachments/v1/objects`; a deleted session's images are removed only when no remaining session references them, so shared images survive.
- **Two entry points** — a full **Sessions** panel in the left sidebar (search, multi-select delete, trash view, permanent purge) and a **Delete session…** item in every session row's `⋯` menu.
- **Safe by construction** — owner-only HTTP routes, a 60-second guard on freshly written objects, and an all-or-nothing rule: if any remaining session log cannot be read, attachment collection is skipped rather than guessed.

Full description: [English detail](docs/DETAIL.md) · [中文说明](README.zh.md)

## Install

From the Plugins page: **Add plugin** → enter `dsh-session-reaper`. Or:

```sh
dsh plugin --profile <name> add dsh-session-reaper
```

Restart DSH after installing. The sidebar entry **Sessions** appears, and session row menus gain **Delete session…**.

## Data locations

| What | Where |
|---|---|
| Session logs (moved to the trash) | `$DSH_HOME/deleted-sessions/<batch>/<id>/session` + `meta.json` |
| Image objects | `$DSH_HOME/attachments/v1/objects/<sha256-prefix>/<sha256>` |
| Session logs (live) | `$DSH_HOME/sessions/<project>/<id>/` |

## Limitations

- The session log itself stays on disk until you purge the trash entry; only then is the directory removed.
- If you delete with **Also delete the referenced images** checked (the default), restoring that session later leaves its images missing.
- Non-image file attachments (`v1/file-objects`) are not collected.
- Deleting a session that another process is writing may fail; the error names the session.
- No configuration surface yet; the 60-second recent-object guard and the trash location are fixed.

## License

MIT
