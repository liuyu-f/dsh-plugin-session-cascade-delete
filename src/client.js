// session-delete: CLIENT half (browser module-loader package).
//
// Two entry points, one dialog:
//   conversation.session.header.actions   header danger button
//   sidebar.workspaces.session.menu.item   sidebar session-row "..." menu row
// Both open the SAME dialog, a root-scoped shell.overlay occupant fed by a
// module-scoped request store, so the sidebar row never switches the
// conversation.
//
// Everything here is either a slot entry or a slot-owned component: no DOM
// injection outside a component, no `document.body` writes, no other plugin's
// DOM or styles read. Only platform-baseline modules are required (react and
// the host primitives), and every color comes from a `--dsw-alias-*` token.
//
// Locale, and why the `t` seat is never trusted blindly:
//
//   A component registered with `locale: NS` receives the locale service's
//   bound translator as the `t` seat. That translator answers the KEY ITSELF
//   when its namespace has no dictionary yet (`LocaleRuntime.translate` falls
//   back to the key), and the namespace can legitimately be empty for a while:
//   this plugin's own client half may materialize before its dictionaries are
//   registered, and a losing registration race can leave them missing. Rendering
//   that seat verbatim is exactly how a dialog once showed `dialog.title` /
//   `dialog.deleteDesc` on the first open after start-up while a later reload
//   showed real copy.
//
//   So `t` here is always wrapped: the seat wins only when it actually resolves
//   a key, and the built-in zh/en dictionaries answer otherwise. Copy is still
//   routed through the locale service — the built-in dictionaries are the
//   documented fallback for a composition without it, and now also for a
//   namespace that has not been registered yet.
//
// Bundle format (client-modules protocol): classic script registering a lazy
// factory via `window.__ModuleLoader__.load({ id, factory })`; the factory
// receives `require` and returns the plugin exports.
window.__ModuleLoader__.load({
  id: '@liuyu-f/dsh-plugin-session-cascade-delete',
  factory(require) {
    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const { Button, IconTrashOutlineRegular, MenuItemButton, Modal, Tooltip } = primitives

    const HEADER_SLOT = 'conversation.session.header.actions'
    const MENU_SLOT = 'sidebar.workspaces.session.menu.item'
    const OVERLAY_SLOT = 'shell.overlay'
    const HEADER_ID = 'session-delete.header'
    const MENU_ID = 'session-delete.menu'
    const DIALOG_ID = 'session-delete.dialog'
    const ENDPOINT = '/__chameleon/session/delete'
    const NS = 'session-delete'

    // --- copy -------------------------------------------------------------------

    const zh = {
      'button.title': '删除会话',
      'button.titleRunning': '删除会话（运行中，删除将停止任务）',
      'menu.delete': '删除会话',
      'dialog.title': '删除会话',
      'dialog.cancel': '取消',
      'dialog.confirm': '删除',
      'dialog.confirming': '删除中…',
      'dialog.untitled': '未命名会话',
      'dialog.session': '会话：',
      'dialog.sessionId': '序列号：',
      'dialog.runningWarn': '⚠ 会话正在运行',
      'dialog.runningDesc': '该会话正在运行，删除会先停止其任务再永久删除；正在进行的操作将中断且无法恢复。',
      'dialog.deleteDesc': '将永久删除该会话及其全部对话记录（会话日志、投影缓存与工作区记账），此操作不可恢复。',
      'dialog.busy': '正在删除…',
      'dialog.failed': '删除失败：{reason}',
    }

    const en = {
      'button.title': 'Delete session',
      'button.titleRunning': 'Delete session (running — deleting stops the task)',
      'menu.delete': 'Delete session',
      'dialog.title': 'Delete session',
      'dialog.cancel': 'Cancel',
      'dialog.confirm': 'Delete',
      'dialog.confirming': 'Deleting…',
      'dialog.untitled': 'Untitled session',
      'dialog.session': 'Session: ',
      'dialog.sessionId': 'Session ID: ',
      'dialog.runningWarn': '⚠ Session is running',
      'dialog.runningDesc': 'This session is running. Deleting it stops its task first and then removes it permanently; work in progress is interrupted and cannot be recovered.',
      'dialog.deleteDesc': 'This permanently deletes the session and all of its conversation records (session log, projection cache and workspace accounting). This action cannot be undone.',
      'dialog.busy': 'Deleting…',
      'dialog.failed': 'Delete failed: {reason}',
    }

    // Client-scope service handles, refreshed by deferred injection when the
    // service was not ready at apply time.
    let localeService = null
    let uiWorkspaceService = null

    function builtinLang() {
      if (typeof navigator === 'undefined') return 'zh'
      const tags = [].concat(navigator.languages || [], [navigator.language])
      for (const tag of tags) {
        const primary = String(tag || '').toLowerCase().split('-')[0]
        if (primary === 'zh' || primary === 'en') return primary
      }
      return 'zh'
    }

    function builtinText(key, values) {
      const dict = builtinLang() === 'en' ? en : zh
      const template = dict[key]
      if (template === undefined) return key
      if (values === undefined) return template
      return template.replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole))
    }

    /** The locale seat when the renderer supplied one, else null. */
    function seatOf(props) {
      return props !== null && props !== undefined && typeof props.t === 'function' ? props.t : null
    }

    /**
     * Resolve one visible string.
     *
     * The locale seat wins only when it actually translates: a seat bound to a
     * namespace without a dictionary yet answers with the key, and rendering
     * that is the bug this function exists to prevent.
     */
    function resolveText(seat, key, values) {
      if (seat !== null) {
        try {
          const text = seat(key, values)
          if (typeof text === 'string' && text !== '' && text !== key) return text
        } catch {
          /* a broken seat must not blank the copy */
        }
      }
      return builtinText(key, values)
    }

    // --- shared dialog request store ---------------------------------------------

    // One request at a time: the header button and the sidebar row both open the
    // same dialog and the last request wins. Every mounted component subscribes,
    // so the dialog occupant never depends on which entry dispatched.
    const listeners = new Set()
    let request = null
    let revision = 0

    function setRequest(next) {
      request = next
      revision += 1
      for (const listener of [...listeners]) {
        try {
          listener(revision)
        } catch {
          /* one broken subscriber must not break the others */
        }
      }
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }

    function useRequest() {
      const [value, setValue] = React.useState(request)
      React.useEffect(() => subscribe(() => setValue(request)), [])
      return value
    }

    // --- post-delete view repair -------------------------------------------------

    // The sidebar LIST needs no help: the Host announces `api-session/removed`
    // after a clean delete and the session controller applies it. The MAIN VIEW
    // is a different thing — list membership and view selection are separate,
    // and nothing in the shipped composition closes the view when its session
    // leaves the list, so a deleted open session would keep rendering with its
    // title fallen back to a bare id.
    //
    // `uiWorkspace` is reached through `ctx.inject`, never `ctx.get`: its fiber
    // builds that service asynchronously at activation and `ctx.get` is
    // strict-gated on the provider fiber already being active.
    //
    // The subject is read from `uiWorkspace.mainReference` — the field
    // `replaceMain()` assigns a retained reference to and `clearMain()` empties;
    // the reference carries `sessionId`. There is no public equivalent, so an
    // unexpected shape degrades to "nothing is open" and the view is untouched.
    // Deliberately NO `sessions.refresh()`: a second writer for the list races
    // the workspace-accounting removal into an "Ungrouped" row.

    function idCore(value) {
      const text = String(value ?? '')
      return text.startsWith('session-') ? text.slice('session-'.length) : text
    }

    function repairViewAfterDelete(deletedSessionId) {
      try {
        const workspace = uiWorkspaceService
        if (workspace === null || workspace === undefined) return
        const reference = workspace.mainReference
        const openId = reference === null || reference === undefined ? undefined : reference.sessionId
        if (typeof openId !== 'string' || openId.length === 0) return
        if (idCore(openId) !== idCore(deletedSessionId)) return
        // Clear, do not start: `startSession()` is the New Session flow, and each
        // call that finds no reusable blank creates one — so every delete left
        // another in-memory (untitled) Session behind. `clearMain()` is what the
        // shipped code does when the current Session leaves the list (see
        // `clearArchivedCurrent()` behind the archive paths), and deletion is the
        // same situation. A later New Session then reuses whatever blank exists
        // instead of adding one.
        if (typeof workspace.clearMain !== 'function') return
        workspace.clearMain()
      } catch {
        /* cleanup must never surface as an unhandled error in a slot entry */
      }
    }

    // --- dialog ------------------------------------------------------------------

    function DeleteSessionDialog(props) {
      const seat = seatOf(props)
      const t = (key, values) => resolveText(seat, key, values)
      const current = useRequest()
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)

      // Every new request clears the last outcome.
      React.useEffect(() => {
        setBusy(false)
        setError(null)
      }, [current === null ? null : current.requestId])

      const close = React.useCallback(() => {
        if (busy) return
        setRequest(null)
      }, [busy])

      const confirm = React.useCallback(() => {
        const target = current
        if (target === null || busy) return
        setBusy(true)
        setError(null)
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: target.sessionId }),
        })
          .then(async (response) => {
            let payload = {}
            try {
              payload = await response.json()
            } catch {
              /* an empty or non-JSON body keeps the HTTP status as the reason */
            }
            if (!response.ok || payload?.ok !== true) {
              throw new Error(payload?.error || `HTTP ${response.status}`)
            }
            setRequest(null)
            repairViewAfterDelete(target.sessionId)
          })
          .catch((reason) => {
            setBusy(false)
            setError(reason?.message ?? String(reason))
          })
      }, [current, busy])

      if (current === null) return null

      const title = current.displayTitle || t('dialog.untitled')
      const description = current.running === true ? t('dialog.runningDesc') : t('dialog.deleteDesc')

      // Follow the host's own confirm dialog instead of inventing chrome.
      //
      // The host builds "are you sure" surfaces out of exactly three things
      // (see `ui-workspace`'s SessionArchiveConfirmDialog and the primitives'
      // RiskConfirmation stylesheet): `Modal` with `title` + `description`, a
      // plain `outline` Cancel, and a plain `primary` confirm. Their warning row
      // is neutral text with only the ICON in the error color, and their confirm
      // button carries no danger styling at all — the risk is in the words.
      //
      // So: no acknowledgement checkbox (opening the dialog and pressing Delete
      // is already the deliberate two-step gesture, and the data-level guards
      // live in the Host), no hand-rolled danger button, and the warning row is
      // shown only when it says something the description does not — i.e. when
      // the session is running.
      return React.createElement(Modal, {
        open: true,
        onClose: close,
        title: t('dialog.title'),
        closeLabel: t('dialog.cancel'),
        description,
        footer: [
          React.createElement(Button, {
            key: 'cancel',
            variant: 'outline',
            onClick: close,
            disabled: busy,
          }, t('dialog.cancel')),
          React.createElement(Button, {
            key: 'confirm',
            variant: 'outline',
            style: DANGER_TEXT,
            onClick: confirm,
            disabled: busy,
          }, busy ? t('dialog.confirming') : t('dialog.confirm')),
        ],
      }, React.createElement('div', { style: metaStyle },
        t('dialog.session'), title,
        React.createElement('br'),
        t('dialog.sessionId'), current.sessionId,
        current.running === true
          ? React.createElement('div', { style: runningRowStyle }, t('dialog.runningWarn'))
          : null,
        busy ? React.createElement('div', { style: statusStyle }, t('dialog.busy')) : null,
        error !== null
          ? React.createElement('div', { style: errorStyle, role: 'alert' }, t('dialog.failed', { reason: error }))
          : null),
      )
    }

    // The destructive confirm is an OUTLINE button whose TEXT carries the error
    // color — exactly the host's own rule for a destructive confirm:
    //
    //   ui-workspace: .deleteAction:not(:disabled) { color: var(--dsw-alias-state-error-primary) }
    //   (used as <Button variant="outline" className={deleteAction}>)
    //
    // The primitives publish no danger variant, and a plugin cannot import the
    // host's CSS module, so the token is applied directly. This is the ONE
    // deliberate departure from "use the primitives as-is"; it is copied from the
    // host's rule rather than invented, and it degrades to a plain outline button
    // if the token ever disappears.
    const DANGER_TEXT = { color: 'var(--dsw-alias-state-error-primary)' }

    // The running hint. The copy already opens with a warning glyph, so this row
    // carries no icon of its own — the host's `.warning` body text is neutral,
    // and a second marker would just shout twice.
    const runningRowStyle = {
      marginTop: 10,
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: 13,
      lineHeight: '20px',
    }

    const metaStyle = {
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: 13,
      lineHeight: '20px',
      overflowWrap: 'anywhere',
    }

    const statusStyle = {
      color: 'var(--dsw-alias-label-secondary)',
      fontSize: 12,
      lineHeight: '16px',
      marginTop: 6,
    }

    const errorStyle = {
      color: 'var(--dsw-alias-state-error-primary)',
      fontSize: 12,
      lineHeight: '16px',
      marginTop: 6,
    }

    // --- header danger button ----------------------------------------------------

    /** The live client summary for one session, or undefined. */
    function useSummaryOf(useSessions, sessionId) {
      if (typeof useSessions !== 'function' || sessionId === undefined || sessionId === null) return undefined
      // The selector runs inside the store's own hook, so a missing row must
      // resolve to undefined rather than throw out of the slot entry.
      return useSessions((state) => (state && state.byId ? state.byId[sessionId] : undefined))
    }

    function DeleteSessionButton(props) {
      const sessionId = props.sessionId
      const seat = seatOf(props)
      const t = (key, values) => resolveText(seat, key, values)
      const summary = useSummaryOf(props.useSessions, sessionId)
      const running = summary?.running === true
      const displayTitle = summary?.displayTitle ?? summary?.title ?? null
      const label = running ? t('button.titleRunning') : t('button.title')

      const open = React.useCallback(() => {
        setRequest({ requestId: `${Date.now()}:${sessionId}`, sessionId, displayTitle, running })
      }, [sessionId, displayTitle, running])

      return React.createElement(Tooltip, {
        label,
        side: 'bottom',
        align: 'end',
        delayMs: 500,
        children: React.createElement(Button, {
          variant: 'ghost',
          size: 'sm',
          'aria-label': label,
          onClick: open,
          icon: React.createElement(IconTrashOutlineRegular, { size: 16 }),
        }),
      })
    }

    // --- sidebar session-row menu row --------------------------------------------

    function DeleteSessionMenuItem(props) {
      const sessionId = props.sessionId
      const seat = seatOf(props)
      const t = (key, values) => resolveText(seat, key, values)
      const summary = useSummaryOf(props.useSessions, sessionId)
      const running = summary?.running === true
      const displayTitle = props.displayTitle ?? summary?.displayTitle ?? null
      const openMenuState = props.useMenuOpenState
      const menu = typeof openMenuState === 'function' ? openMenuState() : undefined
      const closeMenu = menu && typeof menu[1] === 'function' ? menu[1] : null

      const select = React.useCallback(() => {
        if (closeMenu !== null) closeMenu(false)
        setRequest({ requestId: `${Date.now()}:${sessionId}`, sessionId, displayTitle, running })
      }, [closeMenu, sessionId, displayTitle, running])

      return React.createElement(MenuItemButton, {
        danger: true,
        separatorBefore: true,
        icon: React.createElement(IconTrashOutlineRegular, { size: 14 }),
        onSelect: select,
      }, t('menu.delete'))
    }

    // --- apply ------------------------------------------------------------------

    function apply(ctx) {
      // Locale: dictionaries are registered whenever the service is available,
      // and a registration that loses a race is retried on subscription. The
      // components never depend on the timing because `resolveText` falls back
      // to the built-in dictionaries.
      const adoptLocale = (locale) => {
        if (locale === null || locale === undefined) return
        localeService = locale
        if (typeof locale.register !== 'function') return
        ctx.effect(() => {
          const disposer = locale.register(NS, { zh, en })
          // A dictionary that landed after the first render leaves components
          // showing their built-in copy; nudge every subscriber to re-render so
          // the seat starts answering.
          setRequest(request)
          return disposer
        }, 'session-delete: dictionaries')
      }
      adoptLocale(ctx.get('locale'))
      if (localeService === null) ctx.inject(['locale'], (sub) => adoptLocale(sub.locale))

      // The workspace service owns the main view: `mainReference` names the
      // session it holds and `clearMain()` empties it. Neither is in the published
      // service type — both are reached as class members, the same risk this file
      // already took to repair the view after a delete. An unexpected shape means
      // the view is left alone rather than a phantom Session created.
      uiWorkspaceService = ctx.get('uiWorkspace') ?? null
      if (uiWorkspaceService === null) {
        ctx.inject(['uiWorkspace'], (sub) => {
          uiWorkspaceService = sub.uiWorkspace ?? null
        })
      }

      // `useSessions` (running state, display title) and a session-scoped
      // `sessionId` are STANDARD props the renderer injects for every entry, so
      // only the row owner's `useMenuOpenState` has to be contributed here.
      const menuInjected = (standard, hookContext) => ({
        hooks: {
          menuOpenState: () => (typeof hookContext === 'function' ? hookContext : () => [false, () => {}]),
        },
      })

      ctx.slots.inject(HEADER_SLOT, () => ctx.slots.register({
        name: HEADER_SLOT,
        id: HEADER_ID,
        order: 30,
        locale: NS,
      }, DeleteSessionButton))

      ctx.slots.inject(MENU_SLOT, () => ctx.slots.register({
        name: MENU_SLOT,
        id: MENU_ID,
        order: 500,
        locale: NS,
        inject: menuInjected,
      }, DeleteSessionMenuItem))

      ctx.slots.inject(OVERLAY_SLOT, () => ctx.slots.register({
        name: OVERLAY_SLOT,
        id: DIALOG_ID,
        order: 100,
        locale: NS,
      }, DeleteSessionDialog))
    }

    // `slots` is the hard dependency; `locale` is optional by design, because
    // the built-in dictionaries already cover a composition without it.
    return { apply, inject: ['slots'] }
  },
})
