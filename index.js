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
  let rawLogs = ''
  let lastKarmaLine
  let monthDay = ''
  const matchMonthDay = new RegExp('^([A-Z][a-z]{2}[ ]{1,2}[0-9]{1,2}) ')

  for (const line of matched.split('\n')) {
    if (!line) continue

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

    rawLogs += `${escapeHtml(trimmed)}<br>`
    if (/\[karma/.test(line) && /awards/.test(line)) {
      lastKarmaLine = line
    }
  }

  let awardNums = []
  if (lastKarmaLine) {
    const bits = lastKarmaLine.match(/awards: ([0-9,]+)?\s*/)
    if (bits && bits[1]) awardNums = bits[1].split(',')
  }

  done(
    `${
      htmlHead() +
      htmlBody(
        `for connection ${escapeHtml(uuid)} on ${escapeHtml(monthDay)}`,
        getAwards(awardNums).join(''),
        getResolutions(awardNums).join(''),
      ) +
      rawLogs
    }</pre></div></body></html>`,
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
      </style>
    </head>`
}

function htmlBody(desc, awards, resolve) {
  let str = `<body>
        <div class="tab-content">
        <h3>Sorry if we blocked your message:</h3>
        <p>Our filters mistook your server for a malicious computer attempting
        to send spam. To improve your mail servers reputation, please contact
        your IT helpdesk or Systems Administrator and ask them for help.</p>`

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
        <p>${desc}</p>
        <pre>
        \n`
  return str
}
