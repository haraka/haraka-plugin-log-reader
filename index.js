'use strict'

// node.js built-in modules
const { spawn } = require('node:child_process')

let log = '/var/log/haraka.log'
// plugin is stored at module scope so that Express route handler callbacks
// (which have no `this` binding) can reach plugin methods and config.
let plugin

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[mGKHF]/g
function stripAnsi(str) {
  return str.replace(ANSI_RE, '')
}
exports.stripAnsi = stripAnsi

function parseLogLine(line) {
  // Format after stripping: [timestamp? ][LEVEL][ [txn] ][plugin] message
  const m = line.match(
    /(?:[0-9]{1,2}:[0-9]{2}:[0-9]{2} )?\[([A-Z]+)\]\s+(?:\[([0-9]+)\]\s+)?\[([^\]]+)\]\s*(.*)/,
  )
  if (!m) return { level: '', txn: '', plugin: '', message: line.trim() }
  return {
    level: m[1].toLowerCase(),
    txn: m[2] || '',
    plugin: m[3] || '',
    message: m[4] || '',
  }
}
exports.parseLogLine = parseLogLine

function dispositionForCode(code) {
  switch (String(code).toUpperCase()) {
    case 'OK':
      return 'delivered'
    case 'DENY':
      return 'blocked'
    case 'TEMPFAIL':
    case 'DENYSOFT':
      return 'delayed'
    default:
      return 'unknown'
  }
}

function detectDisposition(lines) {
  for (const line of lines) {
    const m = line.match(/\[core\] queue code=(\S+)/)
    if (!m) continue
    const d = dispositionForCode(m[1])
    if (d !== 'unknown') return d
  }
  return 'unknown'
}
exports.detectDisposition = detectDisposition

function txnOf(line) {
  const idm = line.match(/ \[([A-F0-9\-.]{12,40})\] /)
  if (!idm) return ''
  const t = idm[1].match(/\.([0-9]{1,2})$/)
  return t ? t[1] : ''
}

// Per-transaction dispositions for a connection. get_logs greps with the
// .N suffix stripped, so a connection that sent several messages has all
// of their lines here. Outcome signals, strongest first:
//   1. `[core] queue code=` — the definitive queue result (final).
//   2. a plugin hook `retval=DENY*/DENYSOFT*` — message rejected before
//      it ever reached the queue (no queue line is logged for these).
//   3. the `disconnect ... lr="<code> ..."` last response — a
//      connection-level fallback for rejections with no per-txn line
//      (e.g. denied at connect/helo/rcpt).
function detectTransactions(lines) {
  const byTxn = new Map() // txn -> { disposition, final }
  let connFallback // 'blocked' | 'delayed' | 'delivered' from disconnect lr=
  let discTxns // transaction count from the disconnect summary line

  for (const line of lines) {
    const q = line.match(/\[core\] queue code=(\S+)/)
    if (q) {
      byTxn.set(txnOf(line), {
        disposition: dispositionForCode(q[1]),
        final: true,
      })
      continue
    }

    const rv = line.match(
      /\bretval=(DENYSOFTDISCONNECT|DENYSOFT|DENYDISCONNECT|DENY)\b/,
    )
    if (rv) {
      const txn = txnOf(line)
      const cur = byTxn.get(txn)
      if (!cur || !cur.final) {
        byTxn.set(txn, {
          disposition: /SOFT/.test(rv[1]) ? 'delayed' : 'blocked',
          final: false,
        })
      }
      continue
    }

    // A `deny hook` (e.g. karma) can veto an earlier DENY and let the
    // connection continue. Haraka logs this; drop the tentative (non-
    // final) denies recorded before it -- they did not take effect. A
    // real DENY logged after the override is kept.
    if (/overrid(?:den|en) by deny hook/i.test(line)) {
      for (const [k, v] of byTxn) {
        if (!v.final) byTxn.delete(k)
      }
      continue
    }

    if (/\bdisconnect\b/.test(line)) {
      const tx = line.match(/\btxns=(\d+)/)
      if (tx) discTxns = Number(tx[1])
      const lr = line.match(/\blr="([2-5])\d\d/)
      if (lr) {
        connFallback =
          lr[1] === '5' ? 'blocked' : lr[1] === '4' ? 'delayed' : 'delivered'
      }
    }
  }

  const out = [...byTxn.entries()]
    .map(([txn, v]) => ({ txn, disposition: v.disposition }))
    .sort((a, b) => Number(a.txn) - Number(b.txn))

  if (out.length) return out

  // No per-transaction signal. A connection that never opened a
  // transaction (txns=0) sent no message at all -- only a 5xx last
  // response (rejected before DATA) is a real "blocked" outcome; a
  // 2xx/4xx/empty response to non-mail commands is not.
  if (discTxns === 0) {
    return [
      { txn: '', disposition: connFallback === 'blocked' ? 'blocked' : 'none' },
    ]
  }
  if (connFallback) return [{ txn: '', disposition: connFallback }]
  return []
}
exports.detectTransactions = detectTransactions

// Which single log line decided the connection's fate, so the renderer
// can highlight that row (not, e.g., a DENY that was later overridden).
// Mirrors detectTransactions precedence: a per-message queue line colours
// itself, so when any queue line exists there is no extra "terminal" row;
// otherwise it is the surviving (non-overridden) DENY, else the
// disconnect line when it carries a 4xx/5xx last response.
function findDecisive(lines) {
  let pending = null // tentative DENY: { idx, disposition }
  let terminal = null // disconnect 4xx/5xx: { idx, disposition }
  let hasQueue = false

  lines.forEach((line, idx) => {
    if (/\[core\]\s+queue code=/.test(line)) {
      hasQueue = true
      return
    }
    const rv = line.match(
      /\bretval=(DENYSOFTDISCONNECT|DENYSOFT|DENYDISCONNECT|DENY)\b/,
    )
    if (rv) {
      pending = { idx, disposition: /SOFT/.test(rv[1]) ? 'delayed' : 'blocked' }
      return
    }
    if (/overrid(?:den|en) by deny hook/i.test(line)) {
      pending = null
      return
    }
    if (/\bdisconnect\b/.test(line)) {
      const lr = line.match(/\blr="([45])\d\d/)
      if (lr) {
        terminal = {
          idx,
          disposition: lr[1] === '5' ? 'blocked' : 'delayed',
        }
      }
    }
  })

  if (hasQueue) return null
  return pending || terminal || null
}
exports.findDecisive = findDecisive

function formatPluginLink(name) {
  if (!name) return ''
  if (name === 'core') return escapeHtml(name)
  const url = `https://haraka.github.io/plugins/${encodeURIComponent(name)}/`
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a>`
}

exports.register = function () {
  plugin = this
  this.get_logreader_ini()
  this.load_karma_ini()
}

exports.hook_init_http = function (next, server) {
  server.http.app.get('/logs/:uuid', exports.get_logs)
  server.http.app.get('/karma/rules', exports.get_rules)
  next()
}

exports.get_logreader_ini = function () {
  plugin.cfg = plugin.config.get(
    'log.reader.ini',
    {
      booleans: ['-main.allow_rules_endpoint'],
    },
    function () {
      plugin.get_logreader_ini()
    },
  )

  if (plugin.cfg.log && plugin.cfg.log.file) {
    log = plugin.cfg.log.file
  }
}

exports.load_karma_ini = function () {
  plugin.karma_cfg = plugin.config.get('karma.ini', () => {
    plugin.load_karma_ini()
  })

  if (!plugin.karma_cfg.result_awards) return
  if (!plugin.result_awards) plugin.result_awards = {}

  for (const anum of Object.keys(plugin.karma_cfg.result_awards)) {
    const parts = plugin.karma_cfg.result_awards[anum]
      .replace(/\s+/g, ' ')
      .split(/(?:\s*\|\s*)/)

    plugin.result_awards[anum] = {
      pi_name: parts[0],
      property: parts[1],
      operator: parts[2],
      value: parts[3],
      award: parts[4],
      reason: parts[5],
      resolution: parts[6],
    }
  }
}

exports.get_rules = function (req, res) {
  if (plugin.cfg.main.allow_rules_endpoint === true) {
    return res.send(JSON.stringify(plugin.result_awards))
  }
  return res.status(403).send('<html><body>Forbidden</body></html>')
}

exports.get_logs = function (req, res) {
  const uuid = req.params.uuid
  // Canonical Haraka connection UUID (RFC-4122 shape: 8-4-4-4-12 hex),
  // with an optional .N transaction suffix. Strict validation keeps
  // untrusted input out of the grep pattern entirely -- no regex
  // metacharacters and no leading '-' that grep would parse as an option.
  if (
    !/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}(?:\.\d{1,2})?$/i.test(
      uuid,
    )
  ) {
    return res.status(400).send('<html><body>Invalid Request</body></html>')
  }

  // spawning a grep process is quite a lot faster than fs.read
  exports.grepLog(log, uuid, function (err, matched) {
    if (err) {
      plugin.logerror(err)
      return res
        .status(500)
        .send('<html><body>Internal Server Error</body></html>')
    }

    exports.asHtml(uuid, matched, function (html) {
      res.send(html)
    })
  })
}

const GREP_MAX_BYTES = 5 * 1024 * 1024 // cap response buffering
const GREP_TIMEOUT_MS = 20 * 1000

exports.grepLog = function (file, uuid, done) {
  let searchString = uuid

  if (/\.[0-9]{1,2}$/.test(uuid)) {
    // strip transaction off ID, so connection properties are included
    searchString = uuid.replace(/\.[0-9]{1,2}$/, '')
  }

  let matched = ''
  let stderr = ''
  let finished = false
  let timer

  function finish(err, data) {
    if (finished) return
    finished = true
    clearTimeout(timer)
    done(err, data)
  }

  // -F: treat searchString as a literal, not a regex (defense in depth;
  //     validation already forbids metachars).
  // -e / --: searchString can never be parsed as a grep option, and the
  //     filename is separated from options.
  const child = spawn('grep', ['--text', '-F', '-e', searchString, '--', file])

  timer = setTimeout(() => {
    child.kill('SIGKILL')
    finish(new Error(`grep timed out after ${GREP_TIMEOUT_MS}ms`))
  }, GREP_TIMEOUT_MS)

  child.stdout.on('data', (buffer) => {
    matched += buffer.toString()
    if (matched.length > GREP_MAX_BYTES) {
      child.kill('SIGKILL')
      finish(new Error(`log match exceeded ${GREP_MAX_BYTES} bytes`))
    }
  })

  child.stderr.on('data', (buffer) => {
    stderr += buffer.toString()
  })

  child.on('error', finish)

  child.on('close', (code) => {
    // grep exit status: 0 = match, 1 = no match (both fine), >1 = error
    if (code > 1) {
      return finish(new Error(`grep exited ${code}: ${stderr.trim()}`))
    }
    finish(null, matched)
  })
}

exports.asHtml = function (uuid, matched, done) {
  // Strip ANSI up front so every consumer -- disposition detection, the
  // UUID/hostname/date scrubbing below, and parseLogLine -- sees clean
  // text. Colourised logs would otherwise evade the queue/retval/
  // disconnect matchers.
  const rawLines = matched.split('\n').filter(Boolean).map(stripAnsi)
  const txns = detectTransactions(rawLines)
  const decisive = findDecisive(rawLines)
  let tableRows = ''
  let lastKarmaLine
  let monthDay = ''
  const matchMonthDay = new RegExp('^([A-Z][a-z]{2}[ ]{1,2}[0-9]{1,2}) ')

  let idx = -1
  for (const line of rawLines) {
    idx++
    let transId
    let replaceString = ''

    if (!monthDay) {
      const m = matchMonthDay.exec(line)
      if (m) monthDay = m[1]
    }

    const uuidMatch = line.match(/ \[([A-F0-9\-.]{12,40})\] /)
    if (uuidMatch && uuidMatch[1]) {
      transId = uuidMatch[1].match(/\.([0-9]{1,2})$/)
    }
    if (transId && transId[1]) replaceString = `[${transId[1]}] `

    let trimmed = line
      .replace(/\[[A-F0-9\-.]{12,40}\] /, replaceString) // UUID
      .replace(matchMonthDay, '') // Mon DD

    // strip prepended hostname
    if (/ haraka\[[0-9]+\]: /.test(trimmed)) {
      // with PID
      trimmed = trimmed.replace(/(?: [a-z.-]+)? haraka\[[0-9]+\]: /, ' ')
    } else if (/ haraka: \[/.test(trimmed)) {
      // w/o PID
      trimmed = trimmed.replace(/(?: [a-z.-]+)? haraka: /, ' ')
    }

    const p = parseLogLine(trimmed)
    let rowClass = p.level ? `log-${p.level}` : ''

    // Karma score lines: highlight positive/negative karma
    const karmaScore = trimmed.match(/\[karma\].*\bscore:\s*(-?[0-9]+)/)
    if (karmaScore) {
      const score = parseInt(karmaScore[1], 10)
      if (score > 0) rowClass = 'karma-positive'
      else if (score < 0) rowClass = 'karma-negative'
    }

    // Highlight the row that actually decided the outcome. A per-message
    // `queue code=` line colours itself; otherwise only the single
    // decisive line (a surviving DENY, or the terminal 4xx/5xx
    // disconnect) is highlighted -- never a DENY that a deny hook vetoed.
    const queueMatch = trimmed.match(/\[core\]\s+queue code=(\S+)/)
    if (queueMatch) {
      rowClass = `disposition-${dispositionForCode(queueMatch[1])}`
    } else if (decisive && idx === decisive.idx) {
      rowClass = `disposition-${decisive.disposition}`
    }

    tableRows += `<tr class="${rowClass}">
      <td>${escapeHtml(p.txn)}</td>
      <td>${escapeHtml(p.level.toUpperCase())}</td>
      <td>${formatPluginLink(p.plugin)}</td>
      <td>${escapeHtml(p.message)}</td>
    </tr>\n`

    if (/\[karma/.test(line) && /awards/.test(line)) {
      lastKarmaLine = line
    }
  }

  let awardNums = []
  if (lastKarmaLine) {
    const bits = lastKarmaLine.match(/awards: ([0-9,]+)?\s*/)
    if (bits && bits[1]) awardNums = bits[1].split(',')
  }

  const table = `<div class="log-table">
      <table class="table table-condensed table-hover">
        <thead><tr><th>Txn</th><th>Level</th><th>Plugin</th><th>Message</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`

  done(
    `${
      htmlHead() +
      htmlBody(
        `for connection ${escapeHtml(uuid)} on ${escapeHtml(monthDay)}`,
        txns,
        getAwards(awardNums).join(''),
        getResolutions(awardNums).join(''),
      ) +
      table
    }</div></body></html>`,
  )
}

function getAwards(awardNums) {
  if (!awardNums || awardNums.length === 0) return []

  const awards = []
  for (const a of awardNums) {
    if (!a || !plugin.result_awards[a]) continue
    plugin.result_awards[a].id = a
    awards.push(plugin.result_awards[a])
  }

  const listItems = []
  for (const a of awards.sort(sortByAward)) {
    const start = `<li> ${escapeHtml(a.award)},  `
    if (a.reason) {
      listItems.push(
        `${start + escapeHtml(a.reason)} (${escapeHtml(a.value)})</li>`,
      )
      continue
    }
    listItems.push(
      `${start + escapeHtml(a.pi_name)} ${escapeHtml(a.property)} ${escapeHtml(a.value)}</li>`,
    )
  }
  return listItems
}

function getResolutions(awardNums) {
  if (!awardNums || awardNums.length === 0) return []

  const awards = []
  for (const a of awardNums) {
    if (!a || !plugin.result_awards[a]) continue
    awards.push(plugin.result_awards[a])
  }

  const listItems = []
  const resolutionSeen = {}
  for (const a of awards.sort(sortByAward)) {
    if (!a.resolution) continue
    if (resolutionSeen[a.resolution]) continue
    resolutionSeen[a.resolution] = true
    listItems.push(`<li>${escapeHtml(a.resolution)}</li>`)
  }
  return listItems
}

function sortByAward(a, b) {
  if (parseFloat(b.award) > parseFloat(a.award)) return -1
  if (parseFloat(b.award) < parseFloat(a.award)) return 1
  return 0
}

function htmlHead() {
  return `<html>
    <head>
      <meta charset="utf-8">
      <link rel="stylesheet" href="/haraka/css/bootstrap.min.css">
      <link rel="stylesheet" href="/haraka/css/bootstrap-theme.min.css">
      <style>
        div { padding: 1em; }
        .log-table { padding: 0; overflow-x: auto; }
        .log-table td { font-family: monospace; font-size: 0.85em; white-space: pre-wrap; word-break: break-all; }
        .log-notice td { color: #337ab7; }
        .log-warn td   { color: #8a6d3b; background-color: #fcf8e3; }
        .log-error td  { color: #a94442; }
        .log-crit td,
        .log-emerg td  { color: #a94442; font-weight: bold; }
        .log-debug td  { color: #999; }
        .karma-positive td { background-color: #dff0d8 !important; color: #3c763d !important; }
        .karma-negative td { background-color: #fffff0 !important; color: #8a6d3b !important; }
        .disposition-delivered td { background-color: #3c763d !important; color: #fff !important; font-weight: bold; }
        .disposition-blocked td   { background-color: #a94442 !important; color: #fff !important; font-weight: bold; }
        .disposition-delayed td   { background-color: #8a6d3b !important; color: #fff !important; font-weight: bold; }
      </style>
    </head>`
}

const DISPOSITIONS = {
  delivered: {
    cls: 'success',
    icon: '✓',
    label: 'delivered',
    text: 'This message was delivered.',
  },
  delayed: {
    cls: 'warning',
    icon: '⚠',
    label: 'temporarily delayed',
    text: 'This message was temporarily delayed.',
  },
  blocked: {
    cls: 'danger',
    icon: '✗',
    label: 'blocked',
    text: 'This message was blocked.',
  },
  unknown: {
    cls: 'info',
    icon: '?',
    label: 'undetermined',
    text: 'We could not determine what happened to this message.',
  },
  none: {
    cls: 'info',
    icon: 'ℹ',
    label: 'no message attempted',
    text: 'This connection did not attempt to send a message.',
  },
}

// txns: [{ txn, disposition }] from detectTransactions(). One message
// gets a single alert; several get a per-message list so the recipient
// can see exactly which were delivered, delayed, or blocked.
function htmlBody(desc, txns, awards, resolve) {
  let str = `<body>
        <div class="tab-content">`

  if (txns.length <= 1) {
    const disposition = txns[0] ? txns[0].disposition : 'unknown'
    const d = DISPOSITIONS[disposition] || DISPOSITIONS.unknown
    str += `<div class="alert alert-${d.cls}">${d.icon} ${d.text}</div>`
  } else {
    str += `<div class="alert alert-info">This connection handled ${txns.length} messages:</div>
        <ul class="list-group">`
    for (const t of txns) {
      const d = DISPOSITIONS[t.disposition] || DISPOSITIONS.unknown
      str += `<li class="list-group-item list-group-item-${d.cls}">${d.icon} Message ${escapeHtml(t.txn)}: ${d.label}</li>`
    }
    str += `</ul>`
  }

  const anyBad = txns.some(
    (t) => t.disposition === 'blocked' || t.disposition === 'unknown',
  )
  if (txns.length === 0 || anyBad) {
    str += `<p>Our filters may have mistaken your server for a malicious computer attempting
        to send spam. To improve your mail server&#39;s reputation, please contact
        your IT helpdesk or Systems Administrator and ask them for help.</p>`
  }

  if (awards) {
    str += `<hr><h3>Policy Rules Matched</h3>
        <ul>${awards}</ul>`
  }

  if (resolve) {
    str += `<hr><h3>Steps to Resolve</h3>
        <ul>${resolve}</ul>`
  }

  str += `<hr>
        <h3>Raw Logs</h3>
        <p>${desc}</p>\n`
  return str
}
