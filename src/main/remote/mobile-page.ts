/**
 * The page served to the phone.
 *
 * One inline document with no build step and no external requests: it has to
 * load over a home Wi-Fi with no internet route, and a bundler stage for a few
 * hundred lines of UI would earn nothing. The Content-Security-Policy sent with
 * it forbids loading anything from elsewhere.
 */
export function mobilePage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>D-code</title>
<style>
:root {
  --bg: #1a1a19; --surface: #211f1c; --surface2: #26251f; --line: #33322e;
  --fg: #e8e6e3; --muted: #9b9995; --accent: #d97757; --danger: #e5484d;
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { height: 100%; margin: 0; }
body {
  background: var(--bg); color: var(--fg);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  display: flex; flex-direction: column;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}
header {
  display: flex; align-items: center; gap: .5rem; padding: .6rem .8rem;
  border-bottom: 1px solid var(--line); background: var(--surface);
}
header select {
  flex: 1; min-width: 0; background: var(--surface2); color: var(--fg);
  border: 1px solid var(--line); border-radius: .4rem; padding: .35rem .5rem; font-size: .85rem;
}
.dot { width: .5rem; height: .5rem; border-radius: 50%; background: var(--muted); flex: none; }
.dot.ready { background: #3fb950; }
.dot.thinking { background: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
.dot.error { background: var(--danger); }
@keyframes pulse { 50% { opacity: .3 } }

main { flex: 1; overflow-y: auto; padding: .8rem; overscroll-behavior: contain; }
.msg { margin-bottom: .9rem; }
.who { font-size: .68rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: .25rem; }
.body { white-space: pre-wrap; overflow-wrap: anywhere; font-size: .92rem; }
.user .body { background: var(--surface2); border-radius: .6rem; padding: .5rem .7rem; }
.tools { margin-top: .35rem; display: flex; flex-wrap: wrap; gap: .3rem; }
.tool {
  font-size: .68rem; font-family: ui-monospace, Menlo, monospace; color: var(--muted);
  border: 1px solid var(--line); border-radius: .8rem; padding: .05rem .45rem;
}
#stream { color: var(--fg); opacity: .85; }

footer { border-top: 1px solid var(--line); background: var(--surface); padding: .6rem .8rem; }
.row { display: flex; gap: .5rem; align-items: flex-end; }
textarea {
  flex: 1; resize: none; background: var(--surface2); color: var(--fg);
  border: 1px solid var(--line); border-radius: .6rem; padding: .55rem .7rem;
  font: inherit; font-size: .92rem; max-height: 8rem; min-height: 2.6rem;
}
button {
  background: var(--accent); color: #fff; border: 0; border-radius: .6rem;
  padding: .6rem .9rem; font: inherit; font-size: .9rem; flex: none;
}
button:disabled { opacity: .4; }
button.ghost { background: var(--surface2); color: var(--fg); border: 1px solid var(--line); }
button.danger { background: var(--danger); }

.pair { margin: auto; padding: 2rem 1.5rem; max-width: 20rem; text-align: center; }
.pair h1 { font-size: 1.1rem; margin: 0 0 .4rem; }
.pair p { color: var(--muted); font-size: .85rem; margin: 0 0 1.2rem; }
.pair input {
  width: 100%; text-align: center; font-size: 1.8rem; letter-spacing: .3em;
  font-family: ui-monospace, Menlo, monospace; background: var(--surface2);
  color: var(--fg); border: 1px solid var(--line); border-radius: .6rem; padding: .6rem;
}
.pair button { width: 100%; margin-top: .8rem; }
.error { color: var(--danger); font-size: .82rem; margin-top: .7rem; min-height: 1.2em; }

.permission {
  border: 1px solid var(--accent); border-radius: .6rem; padding: .6rem .7rem;
  margin-bottom: .8rem; background: var(--surface2);
}
.permission h2 { font-size: .85rem; margin: 0 0 .3rem; }
.permission pre {
  font-size: .72rem; margin: 0 0 .6rem; max-height: 8rem; overflow: auto;
  color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere;
}
.permission .row { gap: .5rem; }
.hint { color: var(--muted); font-size: .78rem; text-align: center; padding: 2rem 1rem; }
.offline { background: var(--danger); color: #fff; font-size: .75rem; text-align: center; padding: .2rem; }
[hidden] { display: none !important; }
</style>
</head>
<body>

<div id="pair" class="pair" hidden>
  <h1>D-code</h1>
  <p>Enter the pairing code shown in the app on your computer.</p>
  <!-- Ten characters, letters included: a code is six digits on a local
       network but ten alphanumerics once the tunnel makes the server public.
       A numeric keypad and maxlength=6 made the longer code impossible to
       enter at all — the very case where it matters most. -->
  <input id="code" inputmode="text" autocapitalize="characters" autocorrect="off"
         spellcheck="false" maxlength="10" autocomplete="one-time-code" placeholder="CODE">
  <button id="pairBtn">Connect</button>
  <p class="error" id="pairError"></p>
</div>

<div id="app" hidden style="display:contents">
  <div class="offline" id="offline" hidden>Connection lost — reconnecting…</div>
  <header>
    <span class="dot" id="dot"></span>
    <select id="tabs"></select>
    <button class="ghost" id="stop" hidden>Stop</button>
  </header>

  <main id="log"></main>

  <footer>
    <div class="row">
      <textarea id="input" rows="1" placeholder="Message…" enterkeyhint="send"></textarea>
      <button id="send">Send</button>
    </div>
  </footer>
</div>

<script>
(function () {
  var pairEl = document.getElementById('pair')
  var appEl = document.getElementById('app')
  var logEl = document.getElementById('log')
  var tabsEl = document.getElementById('tabs')
  var inputEl = document.getElementById('input')
  var sendEl = document.getElementById('send')
  var stopEl = document.getElementById('stop')
  var dotEl = document.getElementById('dot')
  var offlineEl = document.getElementById('offline')

  var tabs = []
  var current = null
  var streamEl = null
  var source = null

  function api(path, options) {
    return fetch(path, Object.assign({ credentials: 'same-origin' }, options || {}))
  }

  function post(path, body) {
    return api(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    })
  }

  // ── Pairing ───────────────────────────────────────────────────────────────
  function showPairing(message) {
    pairEl.hidden = false
    appEl.hidden = true
    if (message) document.getElementById('pairError').textContent = message
  }

  document.getElementById('pairBtn').addEventListener('click', function () {
    var code = document.getElementById('code').value.trim()
    post('/api/pair', { code: code })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, body: b } }) })
      .then(function (r) {
        if (r.ok) { pairEl.hidden = true; appEl.hidden = false; start() }
        else document.getElementById('pairError').textContent = r.body.error || 'Could not connect'
      })
      .catch(function () { document.getElementById('pairError').textContent = 'Network error' })
  })

  document.getElementById('code').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('pairBtn').click()
  })

  // Codes are shown in upper case on the computer, and a phone keyboard fights
  // that. The server compares case-insensitively; this just keeps the field
  // looking like the thing being copied.
  document.getElementById('code').addEventListener('input', function (e) {
    var field = e.target
    var cleaned = field.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (cleaned !== field.value) field.value = cleaned
  })

  // ── Rendering ─────────────────────────────────────────────────────────────
  function atBottom() {
    return logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 80
  }

  function scroll(force) {
    if (force || atBottom()) logEl.scrollTop = logEl.scrollHeight
  }

  function messageNode(message) {
    var wrap = document.createElement('div')
    wrap.className = 'msg ' + message.role

    var who = document.createElement('div')
    who.className = 'who'
    who.textContent = message.role === 'user' ? 'You' : 'Claude'
    wrap.appendChild(who)

    if (message.text) {
      var body = document.createElement('div')
      body.className = 'body'
      // textContent, never innerHTML: the transcript is arbitrary text.
      body.textContent = message.text
      wrap.appendChild(body)
    }

    if (message.tools && message.tools.length) {
      var tools = document.createElement('div')
      tools.className = 'tools'
      message.tools.forEach(function (name) {
        var chip = document.createElement('span')
        chip.className = 'tool'
        chip.textContent = name
        tools.appendChild(chip)
      })
      wrap.appendChild(tools)
    }
    return wrap
  }

  function addMessage(message) {
    clearStream()
    logEl.appendChild(messageNode(message))
    scroll()
  }

  function clearStream() {
    if (streamEl) { streamEl.remove(); streamEl = null }
  }

  function appendDelta(text) {
    if (!streamEl) {
      streamEl = messageNode({ role: 'assistant', text: '', tools: [] })
      streamEl.id = 'stream'
      logEl.appendChild(streamEl)
    }
    var body = streamEl.querySelector('.body')
    if (!body) {
      body = document.createElement('div')
      body.className = 'body'
      streamEl.appendChild(body)
    }
    body.textContent += text
    scroll()
  }

  function showPermission(request) {
    var box = document.createElement('div')
    box.className = 'permission'
    box.dataset.requestId = request.requestId

    var title = document.createElement('h2')
    title.textContent = 'Allow ' + request.toolName + '?'
    box.appendChild(title)

    var pre = document.createElement('pre')
    try { pre.textContent = JSON.stringify(request.input, null, 2) } catch (e) { pre.textContent = '' }
    box.appendChild(pre)

    var row = document.createElement('div')
    row.className = 'row'

    var allow = document.createElement('button')
    allow.textContent = 'Allow'
    allow.addEventListener('click', function () { decide(request.requestId, 'allow', box) })

    var deny = document.createElement('button')
    deny.className = 'danger'
    deny.textContent = 'Deny'
    deny.addEventListener('click', function () { decide(request.requestId, 'deny', box) })

    row.appendChild(allow)
    row.appendChild(deny)
    box.appendChild(row)
    logEl.appendChild(box)
    scroll(true)
  }

  function decide(requestId, behavior, box) {
    if (!current) return
    post('/api/tabs/' + encodeURIComponent(current) + '/permission', {
      requestId: requestId, behavior: behavior
    }).then(function () { box.remove() })
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────
  function renderTabs(list) {
    tabs = list
    var previous = current
    tabsEl.innerHTML = ''
    list.forEach(function (tab) {
      var option = document.createElement('option')
      option.value = tab.id
      option.textContent = tab.title + (tab.status === 'thinking' ? ' · working' : '')
      tabsEl.appendChild(option)
    })

    if (!list.length) {
      current = null
      logEl.innerHTML = '<p class="hint">No conversations are running on the computer.</p>'
      return
    }
    if (!previous || !list.some(function (t) { return t.id === previous })) {
      selectTab(list[0].id)
    } else {
      tabsEl.value = previous
      refreshStatus()
    }
  }

  function activeTab() {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].id === current) return tabs[i]
    return null
  }

  function refreshStatus() {
    var tab = activeTab()
    var status = tab ? tab.status : ''
    dotEl.className = 'dot ' + status
    stopEl.hidden = status !== 'thinking'
    sendEl.disabled = !tab
  }

  function selectTab(id) {
    current = id
    tabsEl.value = id
    clearStream()
    logEl.innerHTML = '<p class="hint">Loading…</p>'
    api('/api/tabs/' + encodeURIComponent(id) + '/messages')
      .then(function (r) { return r.json() })
      .then(function (data) {
        if (current !== id) return
        logEl.innerHTML = ''
        ;(data.messages || []).forEach(function (m) { logEl.appendChild(messageNode(m)) })
        if (!data.messages || !data.messages.length) {
          logEl.innerHTML = '<p class="hint">Nothing here yet.</p>'
        }
        scroll(true)
        var tab = activeTab()
        if (tab && tab.pending) showPermission(tab.pending)
      })
    refreshStatus()
  }

  tabsEl.addEventListener('change', function () { selectTab(tabsEl.value) })

  // ── Sending ───────────────────────────────────────────────────────────────
  function send() {
    var text = inputEl.value.trim()
    if (!text || !current) return
    inputEl.value = ''
    inputEl.style.height = 'auto'
    addMessage({ uuid: 'local-' + Date.now(), role: 'user', text: text, tools: [] })
    post('/api/tabs/' + encodeURIComponent(current) + '/send', { text: text }).catch(function () {
      addMessage({ uuid: 'err-' + Date.now(), role: 'assistant', text: 'Could not send.', tools: [] })
    })
  }

  sendEl.addEventListener('click', send)
  stopEl.addEventListener('click', function () {
    if (current) post('/api/tabs/' + encodeURIComponent(current) + '/interrupt')
  })

  inputEl.addEventListener('input', function () {
    inputEl.style.height = 'auto'
    inputEl.style.height = Math.min(inputEl.scrollHeight, 128) + 'px'
  })

  // ── Live stream ───────────────────────────────────────────────────────────
  function start() {
    if (source) source.close()
    source = new EventSource('/api/events')

    source.onopen = function () { offlineEl.hidden = true }
    source.onerror = function () {
      offlineEl.hidden = false
      // EventSource reconnects on its own; a 401 means the cookie is gone and
      // reconnecting forever would be pointless.
      api('/api/tabs').then(function (r) { if (r.status === 401) { source.close(); showPairing('') } })
    }

    source.onmessage = function (event) {
      var data
      try { data = JSON.parse(event.data) } catch (e) { return }

      if (data.type === 'tabs') { renderTabs(data.tabs || []); return }
      if (data.tabId && data.tabId !== current) return

      if (data.type === 'message') addMessage(data.message)
      else if (data.type === 'delta') appendDelta(data.text)
      else if (data.type === 'permission') showPermission(data.request)
      else if (data.type === 'turn-end') clearStream()
    }
  }

  // A cookie from a previous visit means pairing can be skipped.
  api('/api/tabs').then(function (res) {
    if (res.status === 401) { showPairing(''); return }
    appEl.hidden = false
    return res.json().then(function (data) { renderTabs(data.tabs || []); start() })
  }).catch(function () { showPairing('Cannot reach the computer.') })
})()
</script>
</body>
</html>`
}
