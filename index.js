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
  server.http.app.use('/logs/:uuid', exports.get_logs)
  server.http.app.use('/karma/rules', exports.get_rules)
  next()
}

exports.get_logreader_ini = function () {
  plugin.cfg = plugin.config.get('log.reader.ini', function () {
    plugin.get_logreader_ini()
  })

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
  if (plugin.cfg.main.allow_rules_endpoint === false) {
    return res.status(403).send('<html><body>Forbidden</body></html>')
  }
  res.send(JSON.stringify(plugin.result_awards))
}

exports.get_logs = function (req, res) {
  const uuid = req.params.uuid
  if (!/-/.test(uuid)) {
    return res.status(400).send('<html><body>Invalid Request</body></html>')
  }
  if (!/^[0-9A-F\-.]{12,40}$/i.test(uuid)) {
    return res.status(400).send('<html><body>Invalid Request</body></html>')
  }

  // spawning a grep process is quite a lot faster than fs.read
  // (yes, I benchmarked it)
  exports.grepWithShell(log, uuid, function (err, matched) {
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

exports.grepWithShell = function (file, uuid, done) {
  let matched = ''
  let searchString = uuid

  if (/\.[0-9]{1,2}$/.test(uuid)) {
    // strip transaction off ID, so connection properties are included
    searchString = uuid.replace(/\.[0-9]{1,2}$/, '')
  }

  // var child = spawn('grep', [ '-e', regex, file ]);
  const child = spawn('grep', ['--text', searchString, file])
  child.stdout.on('data', function (buffer) {
    matched += buffer.toString()
  })

  child.stdout.on('end', function () {
    done(null, matched)
  })

  child.on('error', done)
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
      try {
        ;[, monthDay] = matchMonthDay.exec(line)
      } catch (err) {
        plugin.loginfo(line)
        plugin.logerror(err)
      }
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

// exports.grepWithFs = function (file, regex, done) {
//     const wantsRe = new RegExp(regex);
//     const fsOpts = { flag: 'r', encoding: 'utf8' };
//     require('fs').readFile(log, fsOpts, function (err, data) {
//         if (err) throw (err);
//         let res = '';
//         data.toString().split(/\n/).forEach(function (line) {
//             if (wantsRe && !wantsRe.test(line)) return;
//             res += line + '\n';
//         });
//         done(null, res);
//     });
// };

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
