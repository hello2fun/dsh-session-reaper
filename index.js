/**
 * Host half of the session manager.
 *
 * DSH keeps every session as one stored log and offers no deletion API, so this
 * plugin owns the missing capability: owner-only Fetch routes move a session's
 * stored log directory into a recoverable trash
 * (`$DSH_HOME/deleted-sessions/<batch>/<id>/`), restore it, list the trash,
 * purge entries permanently, and garbage-collect the image attachments those
 * sessions referenced.
 *
 * Attachments are content-addressed (`sha256:` ids under
 * `$DSH_HOME/attachments/v1/objects`), so an object is deleted only when no
 * remaining session references it. Object deletion is always reported, never
 * silently skipped.
 * @module @local/dsh-session-manager
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Cordis plugin name. */
export const name = 'session-manager'

/** Services the routes need. */
export const inject = ['connection', 'sessionPersistence', 'workspaceRegistry']

/** Shared prefix of every exact route this plugin owns. */
const ROUTE_PREFIX = '/api/session-manager'

/** Largest number of sessions one delete request may carry. */
const MAX_BATCH = 500

/** Canonical image-attachment identity. */
const ATTACHMENT_ID = /^sha256:[0-9a-f]{64}$/u

/** Newer objects are never collected: they may belong to an input not yet checkpointed. */
const RECENT_PROTECT_MS = 60 * 1000

/** The Harness home; the Desktop app normally exports `DSH_HOME`. */
function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** Root of the recoverable trash. */
function trashRoot() {
  return join(dshHome(), 'deleted-sessions')
}

/** Root of the content-addressed image store. */
function objectsRoot() {
  return join(dshHome(), 'attachments', 'v1', 'objects')
}

/** Host path of one image object, or undefined for an id this store does not own. */
function objectPath(attachmentId) {
  if (!ATTACHMENT_ID.test(attachmentId)) return undefined
  const hex = attachmentId.slice('sha256:'.length)
  return join(objectsRoot(), hex.slice(0, 2), hex)
}

/** Human message for a caught value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** JSON answer with the headers these routes always use. */
function json(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

/** Parse a JSON request body, or undefined when it is not JSON. */
async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

/** One batch directory name: a sortable local timestamp. */
function batchStamp() {
  const now = new Date()
  const pad = (value, length = 2) => String(value).padStart(length, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    + `-${pad(now.getMilliseconds(), 3)}`
}

/**
 * Collect every image attachment id referenced anywhere inside one value.
 * @param value - decoded events or any JSON-compatible structure.
 * @param into - set receiving the ids.
 */
function collectAttachmentIds(value, into) {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) collectAttachmentIds(item, into)
    return
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'attachmentId' && typeof nested === 'string' && ATTACHMENT_ID.test(nested)) {
      into.add(nested)
      continue
    }
    if (nested !== null && typeof nested === 'object') collectAttachmentIds(nested, into)
  }
}

/**
 * Read the attachment ids one stored session references.
 * @param ctx - Host context owning the persistence service.
 * @param sessionId - stored session to read.
 * @returns the referenced ids.
 * @throws when the log cannot be decoded; the caller must then treat the set as unknown.
 */
async function readSessionAttachmentIds(ctx, sessionId) {
  const found = new Set()
  const handle = await ctx.sessionPersistence.open(sessionId, 'read')
  try {
    const { events } = await handle.read()
    collectAttachmentIds(events, found)
  } finally {
    await handle.close()
  }
  return found
}

/**
 * Per-session attachment cache. Re-reading every remaining log on each delete
 * would cost tens of seconds, so a session's set is reused until its stored
 * revision moves.
 */
const attachmentCache = new Map()

/**
 * Cached attachment ids of one stored session.
 * @param ctx - Host context owning persistence.
 * @param sessionId - stored session to inspect.
 * @returns the referenced ids, or undefined when the log cannot be decoded.
 */
async function sessionAttachmentIds(ctx, sessionId) {
  let revision = ''
  try {
    revision = String((await ctx.sessionPersistence.stat(sessionId))?.revision ?? '')
  } catch {
    revision = ''
  }
  const cached = attachmentCache.get(sessionId)
  if (cached !== undefined && revision !== '' && cached.revision === revision) return cached.ids
  try {
    const ids = await readSessionAttachmentIds(ctx, sessionId)
    if (revision !== '') attachmentCache.set(sessionId, { revision, ids })
    else attachmentCache.delete(sessionId)
    return ids
  } catch {
    attachmentCache.delete(sessionId)
    return undefined
  }
}

/**
 * Attachment ids referenced by every remaining stored session.
 * @param ctx - Host context owning persistence.
 * @returns the referenced ids and whether every log could be read.
 */
async function liveAttachmentIds(ctx) {
  const found = new Set()
  try {
    // Checkpoint live sessions first so a just-attached image is already referenced by its log.
    await ctx.sessionPersistence.flush()
  } catch {
    // A failed flush leaves the scan as complete as the durable logs allow.
  }
  let rows = []
  try {
    rows = await ctx.sessionPersistence.list()
  } catch {
    return { ids: found, complete: false }
  }
  let complete = true
  for (const row of rows) {
    const id = row?.header?.id
    if (typeof id !== 'string') continue
    const ids = await sessionAttachmentIds(ctx, id)
    if (ids === undefined) {
      complete = false
      continue
    }
    for (const attachmentId of ids) found.add(attachmentId)
  }
  return { ids: found, complete }
}

/** Attachment ids recorded by trashed entries, whose sessions may be restored. */
async function trashedAttachmentIds(root) {
  const found = new Set()
  for (const batch of await batchDirectories(root)) {
    const batchPath = join(root, batch)
    let entries = []
    try {
      entries = await readdir(batchPath, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const found_ = await readEntry(batchPath, entry.name)
      if (found_ === undefined) continue
      for (const id of found_.meta.attachments ?? []) {
        if (typeof id === 'string' && ATTACHMENT_ID.test(id)) found.add(id)
      }
    }
  }
  return found
}

/**
 * Delete candidate objects that no live session (and optionally no trashed
 * entry) references.
 * @param ctx - Host context owning persistence.
 * @param candidates - attachment ids the caller wants gone.
 * @param options - whether trashed entries still count as references.
 * @returns deletion counters and the freed byte count.
 */
async function collectAttachments(ctx, candidates, options) {
  const live = await liveAttachmentIds(ctx)
  const result = {
    deleted: 0,
    freedBytes: 0,
    skippedShared: 0,
    skippedRecent: 0,
    skippedMissing: 0,
    failed: 0,
    incomplete: live.complete !== true,
  }
  // An unreadable log may reference any candidate; deleting then could break a surviving session.
  if (result.incomplete) return result
  const referenced = live.ids
  const protectedByTrash = options.protectTrash === true ? await trashedAttachmentIds(trashRoot()) : new Set()
  const now = Date.now()
  for (const attachmentId of candidates) {
    if (referenced.has(attachmentId) || protectedByTrash.has(attachmentId)) {
      result.skippedShared += 1
      continue
    }
    const target = objectPath(attachmentId)
    if (target === undefined) {
      result.skippedMissing += 1
      continue
    }
    try {
      const info = await stat(target)
      if (now - info.mtimeMs < RECENT_PROTECT_MS) {
        result.skippedRecent += 1
        continue
      }
      const size = info.size
      await rm(target, { force: true })
      await rmdir(dirname(target)).catch(() => {})
      result.deleted += 1
      result.freedBytes += size
    } catch {
      result.failed += 1
    }
  }
  return result
}

/** Every batch directory under the trash, newest first. */
async function batchDirectories(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
      .reverse()
  } catch {
    return []
  }
}

/** Read one trash entry's metadata, or undefined when the entry is incomplete. */
async function readEntry(batchPath, id) {
  const dir = join(batchPath, id)
  try {
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
    if (!existsSync(join(dir, 'session'))) return undefined
    return { dir, meta }
  } catch {
    return undefined
  }
}

/** Find the newest trashed entry for one session id. */
async function findEntry(root, id) {
  for (const batch of await batchDirectories(root)) {
    const entry = await readEntry(join(root, batch), id)
    if (entry !== undefined) return entry
  }
  return undefined
}

/** Best-effort regrouping: re-attach a restored session to the workspace of its recorded directory. */
async function attachToWorkspace(ctx, cwd, sessionId) {
  if (typeof cwd !== 'string' || cwd === '') return
  try {
    const workspace = ctx.workspaceRegistry.list().find(candidate => candidate.path === cwd)
    if (workspace === undefined) return
    await workspace.attachSession(sessionId)
  } catch {
    // Grouping is cosmetic; a stale membership is pruned by the registry.
  }
}

/** Move the sessions named by the request into the trash, optionally collecting their images. */
async function handleDelete(ctx, request) {
  const body = await readJson(request)
  const items = Array.isArray(body?.sessions) ? body.sessions : []
  if (items.length === 0) return json(400, { ok: false, error: 'sessions is required' })
  if (items.length > MAX_BATCH) return json(400, { ok: false, error: `at most ${MAX_BATCH} sessions per request` })
  const pruneAttachments = body?.pruneAttachments !== false

  const root = trashRoot()
  const batchPath = join(root, batchStamp())
  const deleted = []
  const failed = []
  const candidates = new Set()
  await mkdir(batchPath, { recursive: true })

  for (const item of items) {
    const id = typeof item?.id === 'string' ? item.id : ''
    if (!id) {
      failed.push({ id, reason: 'invalid session id' })
      continue
    }
    try {
      const snapshot = await ctx.sessionPersistence.stat(id)
      const location = snapshot?.location
      if (location === undefined || location === null || location.kind !== 'jsonl') {
        failed.push({ id, reason: 'no stored session log' })
        continue
      }
      const sourceDir = dirname(location.path)
      if (!existsSync(sourceDir)) {
        failed.push({ id, reason: 'session log directory is missing' })
        continue
      }
      const attachmentIds = pruneAttachments ? await sessionAttachmentIds(ctx, id) : []
      const attachments = attachmentIds === undefined ? [] : [...attachmentIds]
      const entryDir = join(batchPath, id)
      await mkdir(entryDir, { recursive: true })
      const meta = {
        id,
        title: typeof item?.title === 'string' ? item.title : '',
        cwd: typeof snapshot?.header?.cwd === 'string' ? snapshot.header.cwd : '',
        deletedAt: Date.now(),
        originalDir: sourceDir,
        attachments,
        prunedAtDelete: pruneAttachments,
      }
      await writeFile(join(entryDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
      await rename(sourceDir, join(entryDir, 'session'))
      attachmentCache.delete(id)
      deleted.push(id)
      for (const attachmentId of attachments) candidates.add(attachmentId)
    } catch (error) {
      failed.push({ id, reason: messageOf(error) })
    }
  }

  const collected = candidates.size === 0 || !pruneAttachments
    ? undefined
    : await collectAttachments(ctx, candidates, { protectTrash: false })
  return json(200, { ok: true, deleted, failed, attachments: collected })
}

/** List every recoverable entry. */
async function handleTrash() {
  const root = trashRoot()
  const items = []
  for (const batch of await batchDirectories(root)) {
    const batchPath = join(root, batch)
    let entries = []
    try {
      entries = await readdir(batchPath, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const found = await readEntry(batchPath, entry.name)
      if (found === undefined) continue
      items.push({
        id: found.meta.id ?? entry.name,
        title: found.meta.title ?? '',
        cwd: found.meta.cwd ?? '',
        deletedAt: found.meta.deletedAt ?? 0,
        attachments: Array.isArray(found.meta.attachments) ? found.meta.attachments.length : 0,
      })
    }
  }
  items.sort((left, right) => right.deletedAt - left.deletedAt)
  return json(200, { ok: true, items })
}

/** Restore the sessions named by the request to the directories they came from. */
async function handleRestore(ctx, request) {
  const body = await readJson(request)
  const ids = Array.isArray(body?.ids) ? body.ids : []
  if (ids.length === 0) return json(400, { ok: false, error: 'ids is required' })

  const root = trashRoot()
  const restored = []
  const failed = []
  for (const raw of ids) {
    const id = typeof raw === 'string' ? raw : ''
    if (!id) {
      failed.push({ id, reason: 'invalid session id' })
      continue
    }
    try {
      const entry = await findEntry(root, id)
      if (entry === undefined) {
        failed.push({ id, reason: 'not in the trash' })
        continue
      }
      const target = entry.meta.originalDir
      if (typeof target !== 'string' || target === '') throw new Error('the entry records no original directory')
      if (existsSync(target)) throw new Error('the original directory already exists')
      await mkdir(dirname(target), { recursive: true })
      await rename(join(entry.dir, 'session'), target)
      await rm(entry.dir, { recursive: true, force: true })
      await attachToWorkspace(ctx, entry.meta.cwd, id)
      restored.push(id)
    } catch (error) {
      failed.push({ id, reason: messageOf(error) })
    }
  }
  return json(200, { ok: true, restored, failed })
}

/** Permanently delete named entries, or every entry when `all` is true. */
async function handlePurge(ctx, request) {
  const body = await readJson(request)
  const root = trashRoot()
  const pruneAttachments = body?.pruneAttachments !== false
  const candidates = new Set()

  if (body?.all === true) {
    let removed = 0
    if (pruneAttachments) {
      for (const attachmentId of await trashedAttachmentIds(root)) candidates.add(attachmentId)
    }
    for (const batch of await batchDirectories(root)) {
      await rm(join(root, batch), { recursive: true, force: true })
      removed += 1
    }
    const collected = pruneAttachments && candidates.size > 0
      ? await collectAttachments(ctx, candidates, { protectTrash: false })
      : undefined
    return json(200, { ok: true, removed, attachments: collected })
  }

  const ids = Array.isArray(body?.ids) ? body.ids : []
  if (ids.length === 0) return json(400, { ok: false, error: 'ids or all is required' })

  const purged = []
  const failed = []
  for (const raw of ids) {
    const id = typeof raw === 'string' ? raw : ''
    if (!id) {
      failed.push({ id, reason: 'invalid session id' })
      continue
    }
    try {
      let found = false
      for (const batch of await batchDirectories(root)) {
        const dir = join(root, batch, id)
        if (!existsSync(dir)) continue
        const entry = await readEntry(join(root, batch), id)
        if (pruneAttachments && entry !== undefined) {
          for (const attachmentId of entry.meta.attachments ?? []) {
            if (typeof attachmentId === 'string' && ATTACHMENT_ID.test(attachmentId)) candidates.add(attachmentId)
          }
        }
        await rm(dir, { recursive: true, force: true })
        found = true
      }
      if (found) purged.push(id)
      else failed.push({ id, reason: 'not in the trash' })
    } catch (error) {
      failed.push({ id, reason: messageOf(error) })
    }
  }
  const collected = pruneAttachments && candidates.size > 0
    ? await collectAttachments(ctx, candidates, { protectTrash: false })
    : undefined
  return json(200, { ok: true, purged, failed, attachments: collected })
}

/** Collect every object no live session references and no trashed entry claims. */
async function handleCollect(ctx) {
  const candidates = new Set()
  const root = objectsRoot()
  try {
    for (const prefix of await readdir(root, { withFileTypes: true })) {
      if (!prefix.isDirectory()) continue
      const prefixPath = join(root, prefix.name)
      for (const object of await readdir(prefixPath, { withFileTypes: true })) {
        if (!object.isFile()) continue
        if (/^[0-9a-f]{64}$/u.test(object.name)) candidates.add(`sha256:${object.name}`)
      }
    }
  } catch {
    return json(200, { ok: true, attachments: { deleted: 0, freedBytes: 0, skippedShared: 0, skippedRecent: 0, skippedMissing: 0, failed: 0 } })
  }
  const collected = candidates.size === 0
    ? undefined
    : await collectAttachments(ctx, candidates, { protectTrash: true })
  return json(200, { ok: true, attachments: collected })
}

/**
 * Register the exact routes; each is owner-only because exact routes answer
 * 403 to every non-owner peer.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  const route = (path, methods, fetch) => ctx.effect(
    () => ctx.connection.fetch.register({ path, methods, requestBody: 'buffered', fetch }),
    `session-manager: ${path} route`,
  )
  route(`${ROUTE_PREFIX}/delete`, ['POST'], request => handleDelete(ctx, request))
  route(`${ROUTE_PREFIX}/restore`, ['POST'], request => handleRestore(ctx, request))
  route(`${ROUTE_PREFIX}/purge`, ['POST'], request => handlePurge(ctx, request))
  route(`${ROUTE_PREFIX}/collect`, ['POST'], () => handleCollect(ctx))
  route(`${ROUTE_PREFIX}/trash`, ['GET'], () => handleTrash())
}
