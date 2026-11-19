/**
 * Browser half of the session manager: a sidebar panel that lists every
 * session, a search field, multi-select delete into a recoverable trash, and a
 * trash view that restores or purges entries; plus a "delete" item in every
 * session row menu.
 *
 * The Host half owns the four owner-only routes under `api/session-manager`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-reaper',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState, useSyncExternalStore } = React

    const NS = 'sessionManager'
    const PANEL_ID = 'session-manager'

    const zh = {
      panel: '会话管理',
      subtitle: '删除的会话先进入回收站；默认同时删除它引用的图片附件（这类文件通常最占 C 盘）。',
      search: '搜索标题或路径…',
      refresh: '刷新',
      tabSessions: '会话',
      tabTrash: '回收站',
      selectAll: '全选',
      deleteSelected: '删除选中',
      delete: '删除',
      cancel: '取消',
      confirm: '确认',
      one: '该项',
      confirmDeleteMany: '确定把 {count} 个会话移入回收站？可在「回收站」恢复。',
      confirmDeleteOne: '确定把「{title}」移入回收站？',
      confirmPurgeMany: '确定永久删除这 {count} 项？此操作不可撤销。',
      confirmPurgeOne: '确定永久删除「{title}」？此操作不可撤销。',
      confirmPurgeAll: '确定永久删除回收站里的全部条目？此操作不可撤销。',
      confirmRestore: '确定恢复「{title}」？',
      deleted: '已移入回收站：{count} 个',
      partialDelete: '移入回收站 {done} 个，失败 {failed} 个',
      partialPurge: '永久删除 {done} 个，失败 {failed} 个',
      failed: '操作失败',
      empty: '没有匹配的会话',
      loading: '正在加载会话…',
      emptyTrash: '回收站是空的',
      trashHint: '这些会话的日志已移出会话目录；恢复后会回到原位置并重新归入原工作区。若删除时清理过附件，恢复后原图片可能无法显示。',
      restore: '恢复',
      purge: '彻底删除',
      clearTrash: '清空回收站',
      restored: '已恢复：{count} 个',
      partialRestore: '恢复 {done} 个，失败 {failed} 个',
      purged: '已永久删除',
      running: '运行中',
      blank: '空白',
      blankDraft: '新建会话（空白草稿）',
      showBlank: '显示空白草稿',
      count: '{count} 个会话',
      selected: '已选 {count} 个',
      trashCount: '{count} 项',
      open: '打开',
      menuDelete: '删除会话…',
      menuConfirmOne: '确定删除「{title}」？会话移入回收站，相关图片附件一并删除（不可恢复）。',
      alsoAttachments: '同时删除相关图片附件（不可恢复）',
      attachmentsHint: '图片附件通常占 C 盘大头；取消勾选则只移入回收站，附件保留到彻底删除。',
      collect: '清理未引用附件',
      collectConfirm: '扫描所有会话和回收站，删除没有任何引用的图片附件？只有确实没人引用的对象才会被删除。',
      collectDone: '已清理 {count} 个附件，释放 {size}',
      collectNone: '没有可清理的未引用附件',
      freed: '，释放 {size}',
      incomplete: '；有会话无法读取，附件未清理',
      attachmentsTag: '附件 {count}',
    }

    const en = {
      panel: 'Session manager',
      subtitle: 'Deleted sessions move to a recoverable trash; by default the images they reference are deleted too — usually the largest disk use.',
      search: 'Search title or path…',
      refresh: 'Refresh',
      tabSessions: 'Sessions',
      tabTrash: 'Trash',
      selectAll: 'Select all',
      deleteSelected: 'Delete selected',
      delete: 'Delete',
      cancel: 'Cancel',
      confirm: 'Confirm',
      confirmDeleteMany: 'Move {count} sessions to the trash? You can restore them from Trash.',
      confirmDeleteOne: 'Move “{title}” to the trash?',
      confirmPurgeMany: 'Permanently delete these {count} items? This cannot be undone.',
      confirmPurgeOne: 'Permanently delete “{title}”? This cannot be undone.',
      confirmPurgeAll: 'Permanently delete every trashed item? This cannot be undone.',
      confirmRestore: 'Restore “{title}”?',
      deleted: 'Moved to the trash: {count}',
      partialDelete: 'Moved {done}, failed {failed}',
      partialPurge: 'Permanently deleted {done}, failed {failed}',
      failed: 'The operation failed',
      empty: 'No matching session',
      loading: 'Loading sessions…',
      emptyTrash: 'The trash is empty',
      trashHint: 'Their logs left the sessions directory; restoring returns them to the original location and workspace. Images cleaned at deletion stay gone.',
      restore: 'Restore',
      purge: 'Delete permanently',
      clearTrash: 'Empty trash',
      restored: 'Restored: {count}',
      partialRestore: 'Restored {done}, failed {failed}',
      purged: 'Permanently deleted',
      running: 'Running',
      blank: 'Blank',
      blankDraft: 'New session (empty draft)',
      showBlank: 'Show empty drafts',
      count: '{count} sessions',
      selected: '{count} selected',
      trashCount: '{count} items',
      open: 'Open',
      menuDelete: 'Delete session…',
      menuConfirmOne: 'Delete “{title}”? The session moves to the trash and its referenced images are deleted (not recoverable).',
      alsoAttachments: 'Also delete the referenced images (not recoverable)',
      attachmentsHint: 'Image attachments usually own most of the disk use. Uncheck to keep them until the entry is purged.',
      collect: 'Collect unused attachments',
      collectConfirm: 'Scan every session and the trash, then delete image objects nothing references? Only unreferenced objects are removed.',
      collectDone: 'Collected {count} attachments, freed {size}',
      collectNone: 'No unreferenced attachments to collect',
      freed: ', freed {size}',
      incomplete: '; a session log was unreadable, so attachments were kept',
      attachmentsTag: '{count} images',
    }

    async function requestJson(route, init) {
      const url = new URL(`api/session-manager/${route}`, document.baseURI)
      const response = await fetch(url, init)
      const text = await response.text()
      let value
      try {
        value = text === '' ? undefined : JSON.parse(text)
      } catch {
        throw new Error(`invalid answer (${String(response.status)})`)
      }
      if (!response.ok) throw new Error(value?.error ?? `request failed (${String(response.status)})`)
      return value
    }

    function postJson(route, body) {
      return requestJson(route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    function baseName(path) {
      if (typeof path !== 'string' || path === '') return ''
      const parts = path.split(/[\\/]/u).filter(part => part !== '')
      return parts.length === 0 ? path : parts[parts.length - 1]
    }

    function formatTime(milliseconds) {
      if (typeof milliseconds !== 'number' || milliseconds <= 0) return ''
      try {
        return new Date(milliseconds).toLocaleString()
      } catch {
        return ''
      }
    }

    function formatSize(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '0 B'
      if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
      if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
      return `${Math.round(bytes)} B`
    }

    const CSS = [
      '.sm-root { box-sizing: border-box; height: 100%; overflow: auto; padding: 28px 32px 48px; color: inherit; }',
      '.sm-wrap { max-width: 920px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }',
      '.sm-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }',
      '.sm-h2 { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.4; }',
      '.sm-sub { margin: 4px 0 0; font-size: 12px; opacity: .6; }',
      '.sm-toolbar { display: flex; align-items: center; gap: 8px; }',
      '.sm-input { flex: 1; min-width: 120px; padding: 6px 10px; font-size: 13px; color: inherit; background: transparent; border: 1px solid rgba(127,127,127,.35); border-radius: 6px; outline: none; }',
      '.sm-input:focus { border-color: rgba(127,127,127,.7); }',
      '.sm-btn { padding: 5px 10px; font-size: 12px; color: inherit; background: transparent; border: 1px solid rgba(127,127,127,.35); border-radius: 6px; cursor: pointer; white-space: nowrap; }',
      '.sm-btn:hover:not(:disabled) { border-color: rgba(127,127,127,.7); }',
      '.sm-btn:disabled { opacity: .45; cursor: default; }',
      '.sm-danger { color: #d9534f; border-color: rgba(217,83,79,.45); }',
      '.sm-danger:hover:not(:disabled) { border-color: rgba(217,83,79,.85); }',
      '.sm-tabs { display: flex; gap: 4px; border-bottom: 1px solid rgba(127,127,127,.2); }',
      '.sm-tab { padding: 7px 12px; font-size: 13px; color: inherit; background: transparent; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; cursor: pointer; opacity: .6; }',
      '.sm-tab[data-active="true"] { opacity: 1; border-bottom-color: currentColor; }',
      '.sm-list { border: 1px solid rgba(127,127,127,.25); border-radius: 8px; overflow: hidden; }',
      '.sm-row { display: grid; grid-template-columns: 26px minmax(0,1fr) 160px 130px 72px; align-items: center; gap: 8px; padding: 7px 10px; border-bottom: 1px solid rgba(127,127,127,.15); }',
      '.sm-row:last-child { border-bottom: none; }',
      '.sm-row:hover { background: rgba(127,127,127,.07); }',
      '.sm-row-main { display: flex; align-items: center; gap: 6px; min-width: 0; }',
      '.sm-open { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 0; font-size: 13px; color: inherit; background: none; border: none; cursor: pointer; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.sm-open:hover { text-decoration: underline; }',
      '.sm-tag { flex: none; padding: 0 6px; font-size: 10px; line-height: 16px; border: 1px solid rgba(127,127,127,.4); border-radius: 999px; opacity: .7; }',
      '.sm-meta { font-size: 11px; opacity: .55; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.sm-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; opacity: .8; }',
      '.sm-foot-left { display: flex; align-items: center; gap: 10px; }',
      '.sm-confirm { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 9px 12px; font-size: 12px; border: 1px solid rgba(217,83,79,.45); border-radius: 8px; background: rgba(217,83,79,.07); }',
      '.sm-confirm-text { flex: 1 1 260px; }',
      '.sm-confirm-option { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }',
      '.sm-confirm-hint { flex-basis: 100%; font-size: 11px; opacity: .6; }',
      '.sm-note { font-size: 12px; }',
      '.sm-note[data-tone="ok"] { color: #2e9e44; }',
      '.sm-note[data-tone="error"] { color: #d9534f; }',
      '.sm-empty { padding: 28px 12px; text-align: center; font-size: 12px; opacity: .55; }',
      '.sm-trash-hint { font-size: 11px; opacity: .55; margin: 0; }',
      '.sm-check { margin: 0; accent-color: currentColor; }',
      '.sm-menuitem { display: block; width: 100%; padding: 7px 12px; font-size: 13px; color: inherit; text-align: left; background: transparent; border: none; cursor: pointer; }',
      '.sm-menuitem:hover:not(:disabled) { background: rgba(127,127,127,.12); }',
      '.sm-menuitem:disabled { opacity: .45; cursor: default; }',
    ].join('\n')

    function PanelIcon() {
      return h('svg', {
        width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, style: { display: 'block' },
      },
      h('path', { d: 'M4 6h16' }),
      h('path', { d: 'M4 12h10' }),
      h('path', { d: 'M4 18h7' }),
      h('path', { d: 'M16.5 15.5v-4h5v4a2.5 2.5 0 0 1-5 0Z' }))
    }

    function DeleteMenuItem(props) {
      const t = props.t
      const [busy, setBusy] = useState(false)
      const setMenuOpen = props.useMenuOpenState === undefined
        ? () => {}
        : props.useMenuOpenState()[1]
      const select = async () => {
        setMenuOpen(false)
        if (!window.confirm(t('menuConfirmOne', { title: props.displayTitle }))) return
        setBusy(true)
        try {
          const result = await props.deleteSession([{ id: props.sessionId, title: props.displayTitle }])
          const failure = result?.failed?.[0]
          if (failure !== undefined) window.alert(`${t('failed')}: ${failure.reason}`)
        } catch (error) {
          window.alert(String(error?.message ?? error))
        } finally {
          setBusy(false)
        }
      }
      return h('button', {
        type: 'button', role: 'menuitem', className: 'sm-menuitem', onClick: select, disabled: busy,
      }, t('menuDelete'))
    }

    function SessionManagerPanel(props) {
      const t = props.t
      const sessions = props.sessionService
      const actions = props.actions
      const listStore = sessions.list

      const snapshot = useSyncExternalStore(
        useCallback(callback => listStore.subscribe(callback), [listStore]),
        useCallback(() => listStore.getSnapshot(), [listStore]),
        useCallback(() => listStore.getSnapshot(), [listStore]),
      )

      const [tab, setTab] = useState('sessions')
      const [query, setQuery] = useState('')
      const [showBlank, setShowBlank] = useState(false)
      const [selected, setSelected] = useState(() => new Set())
      const [confirm, setConfirm] = useState(null)
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState(null)
      const [trash, setTrash] = useState({ loaded: false, loading: false, items: [], error: null })

      const rows = useMemo(() => {
        const ids = Array.isArray(snapshot?.ids) ? snapshot.ids : []
        const byId = snapshot?.byId ?? {}
        const collected = []
        for (const id of ids) {
          const row = byId[id]
          if (row === undefined || row === null) continue
          if (row.origin === 'subagent') continue
          // A blank row is a reusable "New session" draft, not conversation history.
          if (!showBlank && row.blank === true) continue
          collected.push(row)
        }
        collected.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
        const needle = query.trim().toLowerCase()
        if (needle === '') return collected
        return collected.filter(row =>
          String(row.displayTitle ?? '').toLowerCase().includes(needle)
          || String(row.cwd ?? '').toLowerCase().includes(needle))
      }, [snapshot, query, showBlank])

      useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => setNotice(null), 5000)
        return () => clearTimeout(timer)
      }, [notice])

      const loadTrash = useCallback(async () => {
        setTrash(current => ({ ...current, loading: true, error: null }))
        try {
          const result = await actions.trash()
          setTrash({ loaded: true, loading: false, items: Array.isArray(result?.items) ? result.items : [], error: null })
        } catch (error) {
          setTrash({ loaded: true, loading: false, items: [], error: String(error?.message ?? error) })
        }
      }, [actions])

      useEffect(() => {
        if (tab === 'trash' && !trash.loaded) void loadTrash()
      }, [tab, trash.loaded, loadTrash])

      const toggle = (id) => {
        setSelected(current => {
          const next = new Set(current)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }

      const toggleAll = () => {
        setSelected(current => {
          const all = rows.length > 0 && rows.every(row => current.has(row.id))
          if (all) return new Set()
          return new Set(rows.map(row => row.id))
        })
      }

      const askDelete = (items) => {
        if (items.length === 0) return
        setConfirm({
          kind: 'delete',
          ids: items.map(item => item.id),
          titles: items.map(item => item.displayTitle || item.title || ''),
          prune: true,
        })
      }

      const runConfirm = async () => {
        const pending = confirm
        setConfirm(null)
        if (pending === null) return
        setBusy(true)
        try {
          if (pending.kind === 'delete') {
            const payload = pending.ids.map((id, index) => ({ id, title: pending.titles[index] ?? '' }))
            const result = await actions.remove(payload, pending.prune !== false)
            const deleted = (result?.deleted ?? []).length
            const failed = (result?.failed ?? []).length
            const freed = result?.attachments?.freedBytes
            const incomplete = result?.attachments?.incomplete === true
            setNotice(failed > 0
              ? { tone: 'error', text: t('partialDelete', { done: String(deleted), failed: String(failed) }) }
              : {
                  tone: 'ok',
                  text: t('deleted', { count: String(deleted) })
                    + (freed > 0 ? t('freed', { size: formatSize(freed) }) : '')
                    + (incomplete ? t('incomplete') : ''),
                })
            setSelected(new Set())
            if (tab === 'trash') await loadTrash()
          } else if (pending.kind === 'purge') {
            const result = await actions.purge(pending.ids, pending.prune !== false)
            const failed = (result?.failed ?? []).length
            const freed = result?.attachments?.freedBytes
            setNotice(failed > 0
              ? { tone: 'error', text: t('partialPurge', { done: String((result?.purged ?? []).length), failed: String(failed) }) }
              : { tone: 'ok', text: t('purged') + (freed > 0 ? t('freed', { size: formatSize(freed) }) : '') })
            await loadTrash()
          } else if (pending.kind === 'purgeAll') {
            const result = await actions.purgeAll(true)
            const freed = result?.attachments?.freedBytes
            setNotice({ tone: 'ok', text: t('purged') + (freed > 0 ? t('freed', { size: formatSize(freed) }) : '') })
            await loadTrash()
          } else if (pending.kind === 'restore') {
            const result = await actions.restore(pending.ids)
            const restored = (result?.restored ?? []).length
            const failed = (result?.failed ?? []).length
            setNotice(failed > 0
              ? { tone: 'error', text: t('partialRestore', { done: String(restored), failed: String(failed) }) }
              : { tone: 'ok', text: t('restored', { count: String(restored) }) })
            await loadTrash()
          } else if (pending.kind === 'collect') {
            const result = await actions.collect()
            const collected = result?.attachments
            if (collected !== undefined && collected.deleted > 0) {
              setNotice({ tone: 'ok', text: t('collectDone', { count: String(collected.deleted), size: formatSize(collected.freedBytes) }) })
            } else {
              setNotice({ tone: 'ok', text: t('collectNone') })
            }
          }
        } catch (error) {
          setNotice({ tone: 'error', text: String(error?.message ?? error) })
        } finally {
          setBusy(false)
        }
      }

      const confirmText = (pending) => {
        if (pending.kind === 'delete') {
          return pending.ids.length === 1
            ? t('confirmDeleteOne', { title: pending.titles[0] || t('one') })
            : t('confirmDeleteMany', { count: String(pending.ids.length) })
        }
        if (pending.kind === 'purge') {
          return pending.ids.length === 1
            ? t('confirmPurgeOne', { title: pending.titles[0] || t('one') })
            : t('confirmPurgeMany', { count: String(pending.ids.length) })
        }
        if (pending.kind === 'restore') {
          return t('confirmRestore', { title: pending.titles[0] || t('one') })
        }
        if (pending.kind === 'collect') {
          return t('collectConfirm')
        }
        return t('confirmPurgeAll')
      }

      const selectedRows = rows.filter(row => selected.has(row.id))
      const allSelected = rows.length > 0 && selectedRows.length === rows.length

      const header = h('div', { className: 'sm-head' },
        h('div', null,
          h('h2', { className: 'sm-h2' }, t('panel')),
          h('p', { className: 'sm-sub' }, t('subtitle'))))

      const tabs = h('div', { className: 'sm-tabs' },
        h('button', { type: 'button', className: 'sm-tab', 'data-active': String(tab === 'sessions'), onClick: () => setTab('sessions') },
          `${t('tabSessions')} · ${String(rows.length)}`),
        h('button', { type: 'button', className: 'sm-tab', 'data-active': String(tab === 'trash'), onClick: () => setTab('trash') },
          `${t('tabTrash')}${trash.loaded ? ` · ${String(trash.items.length)}` : ''}`))

      let body
      if (tab === 'sessions') {
        const list = h('div', { className: 'sm-list' },
          rows.length === 0
            ? h('div', { className: 'sm-empty' }, snapshot?.phase === 'pending' || snapshot?.phase === 'loading' ? t('loading') : t('empty'))
            : rows.map(row => h('div', { className: 'sm-row', key: row.id },
              h('input', {
                type: 'checkbox', className: 'sm-check', checked: selected.has(row.id),
                onChange: () => toggle(row.id), 'aria-label': row.displayTitle ?? row.id,
              }),
              h('div', { className: 'sm-row-main' },
                h('button', {
                  type: 'button', className: 'sm-open',
                  title: row.cwd ?? '', onClick: () => actions.open(row.id),
                },
                h('span', null, row.blank === true ? t('blankDraft') : (row.displayTitle ?? row.id)),
                row.running === true ? h('span', { className: 'sm-tag' }, t('running')) : null)),
              h('span', { className: 'sm-meta', title: row.cwd ?? '' }, baseName(row.cwd)),
              h('span', { className: 'sm-meta' }, formatTime(row.updatedAt)),
              h('button', {
                type: 'button', className: 'sm-btn sm-danger', disabled: busy,
                onClick: () => askDelete([row]),
              }, t('delete')))))

        const toolbar = h('div', { className: 'sm-toolbar' },
          h('input', {
            className: 'sm-input', value: query, placeholder: t('search'),
            onChange: event => setQuery(event.target.value),
          }),
          h('label', { className: 'sm-foot-left' },
            h('input', {
              type: 'checkbox', className: 'sm-check', checked: showBlank,
              onChange: event => setShowBlank(event.target.checked),
            }),
            t('showBlank')),
          h('button', { type: 'button', className: 'sm-btn', onClick: () => { void actions.refresh() } }, t('refresh')))

        const foot = h('div', { className: 'sm-foot' },
          h('div', { className: 'sm-foot-left' },
            h('label', { className: 'sm-foot-left' },
              h('input', { type: 'checkbox', className: 'sm-check', checked: allSelected, onChange: toggleAll }),
              t('selectAll')),
            h('span', null, t('count', { count: String(rows.length) }))),
          h('button', {
            type: 'button', className: 'sm-btn sm-danger', disabled: busy || selectedRows.length === 0,
            onClick: () => askDelete(selectedRows),
          }, `${t('deleteSelected')}${selectedRows.length > 0 ? ` (${String(selectedRows.length)})` : ''}`))

        body = h(React.Fragment, null, toolbar, list, foot)
      } else {
        const trashRows = trash.items.map(item => h('div', { className: 'sm-row', key: `${String(item.id)}-${String(item.deletedAt)}` },
          h('span'),
          h('div', { className: 'sm-row-main' },
            h('span', { className: 'sm-open', title: item.cwd ?? '' }, item.title || item.id),
            typeof item.attachments === 'number' && item.attachments > 0
              ? h('span', { className: 'sm-tag' }, t('attachmentsTag', { count: String(item.attachments) }))
              : null),
          h('span', { className: 'sm-meta', title: item.cwd ?? '' }, baseName(item.cwd)),
          h('span', { className: 'sm-meta' }, formatTime(item.deletedAt)),
          h('span', { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end' } },
            h('button', {
              type: 'button', className: 'sm-btn', disabled: busy,
              onClick: () => setConfirm({ kind: 'restore', ids: [item.id], titles: [item.title || item.id] }),
            }, t('restore')),
            h('button', {
              type: 'button', className: 'sm-btn sm-danger', disabled: busy,
              onClick: () => setConfirm({ kind: 'purge', ids: [item.id], titles: [item.title || item.id] }),
            }, t('purge')))))

        body = h(React.Fragment, null,
          h('p', { className: 'sm-trash-hint' }, t('trashHint')),
          h('div', { className: 'sm-list' },
            trash.loading
              ? h('div', { className: 'sm-empty' }, t('loading'))
              : trashRows.length === 0
                ? h('div', { className: 'sm-empty' }, t('emptyTrash'))
                : trashRows),
          h('div', { className: 'sm-foot' },
            h('span', null, t('trashCount', { count: String(trash.items.length) })),
            h('div', { style: { display: 'flex', gap: '8px' } },
              h('button', {
                type: 'button', className: 'sm-btn', disabled: busy,
                onClick: () => setConfirm({ kind: 'collect', ids: [] }),
              }, t('collect')),
              h('button', {
                type: 'button', className: 'sm-btn sm-danger', disabled: busy || trash.items.length === 0,
                onClick: () => setConfirm({ kind: 'purgeAll', ids: [] }),
              }, t('clearTrash')))))
      }

      const confirmBar = confirm === null ? null : h('div', { className: 'sm-confirm' },
        h('span', { className: 'sm-confirm-text' }, confirmText(confirm)),
        confirm.kind === 'delete'
          ? h('label', { className: 'sm-confirm-option' },
            h('input', {
              type: 'checkbox', className: 'sm-check',
              checked: confirm.prune !== false,
              onChange: event => setConfirm({ ...confirm, prune: event.target.checked }),
            }),
            t('alsoAttachments'))
          : null,
        h('button', { type: 'button', className: 'sm-btn sm-danger', disabled: busy, onClick: () => { void runConfirm() } }, t('confirm')),
        h('button', { type: 'button', className: 'sm-btn', disabled: busy, onClick: () => setConfirm(null) }, t('cancel')),
        confirm.kind === 'delete' ? h('span', { className: 'sm-confirm-hint' }, t('attachmentsHint')) : null)

      const noticeBar = notice === null ? null : h('div', { className: 'sm-note', 'data-tone': notice.tone }, notice.text)

      return h('div', { className: 'sm-root' },
        h('style', null, CSS),
        h('div', { className: 'sm-wrap' },
          header,
          tabs,
          noticeBar,
          confirmBar,
          body,
          trash.error !== null ? h('div', { className: 'sm-note', 'data-tone': 'error' }, trash.error) : null))
    }

    return {
      inject: ['slots', 'locale', 'sessions', 'layout'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-manager: dictionaries')
        const t = ctx.locale.bind(NS)

        const actions = {
          remove: async (items, pruneAttachments) => {
            const result = await postJson('delete', { sessions: items, pruneAttachments })
            if ((result?.deleted ?? []).length > 0) void ctx.sessions.refresh()
            return result
          },
          trash: () => requestJson('trash', { method: 'GET' }),
          restore: async (ids) => {
            const result = await postJson('restore', { ids })
            if ((result?.restored ?? []).length > 0) void ctx.sessions.refresh()
            return result
          },
          purge: (ids, pruneAttachments) => postJson('purge', { ids, pruneAttachments }),
          purgeAll: (pruneAttachments) => postJson('purge', { all: true, pruneAttachments }),
          collect: () => postJson('collect', {}),
          refresh: () => ctx.sessions.refresh(),
          open: (id) => {
            const workspaceUi = ctx.get('uiWorkspace')
            if (workspaceUi !== undefined) workspaceUi.openSession(id)
          },
        }

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 1,
          label: () => t('panel'),
          locale: NS,
        }, PanelIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ sessionService: ctx.sessions, actions }),
        }, SessionManagerPanel))

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'session-manager.delete',
          order: 700,
          locale: NS,
          inject: () => ({ deleteSession: actions.remove }),
        }, DeleteMenuItem))
      },
    }
  },
})
