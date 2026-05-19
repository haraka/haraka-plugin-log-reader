'use strict'

process.env.NODE_ENV = 'test'

const assert = require('node:assert/strict')
const path = require('node:path')
const { describe, it, beforeEach, afterEach } = require('node:test')

const fixtures = require('haraka-test-fixtures')

const mod = require('../index.js')

beforeEach(() => {
  this.reader = new fixtures.plugin('index')

  // replace vm-compiled functions with instrumented versions for coverage tracking
  if (process.env.HARAKA_COVERAGE) {
    Object.assign(this.reader, mod)
  }
})

describe('register', () => {
  it('is a function', () => {
    assert.equal('function', typeof this.reader.register)
  })

  it('runs', () => {
    this.reader.register()
    // console.log(reader.cfg)
  })

  it('loads log.reader.ini', () => {
    this.reader.register()
    assert.deepEqual(this.reader.cfg, {
      main: { allow_rules_endpoint: false },
      log: {
        file: '/var/log/haraka.log',
      },
    })
  })

  it('loads karma.ini', () => {
    this.reader.register()
    this.reader.config = this.reader.config.module_config(path.resolve('test'))
    this.reader.load_karma_ini()
    assert.equal(this.reader.karma_cfg.tarpit.delay, 0)
  })
})

describe('log.reader.ini', () => {
  it('has a log section', () => {
    this.reader.register()
    assert.ok(this.reader.cfg.log.file)
  })
})

describe('stripAnsi', () => {
  it('removes ANSI colour codes', () => {
    assert.equal(mod.stripAnsi('\x1B[38;5;252mhello\x1B[0m'), 'hello')
  })

  it('leaves plain text unchanged', () => {
    assert.equal(mod.stripAnsi('plain text'), 'plain text')
  })

  it('removes multiple codes from a log line', () => {
    const line = '\x1B[32m[INFO]\x1B[0m \x1B[1m[core]\x1B[0m started'
    assert.equal(mod.stripAnsi(line), '[INFO] [core] started')
  })
})

describe('parseLogLine', () => {
  it('parses a connection-level log line', () => {
    const result = mod.parseLogLine('[INFO] [core] connection from 1.2.3.4')
    assert.deepEqual(result, {
      level: 'info',
      txn: '',
      plugin: 'core',
      message: 'connection from 1.2.3.4',
    })
  })

  it('parses a transaction-level log line', () => {
    const result = mod.parseLogLine('[NOTICE] [1] [mail_from] sender ok')
    assert.deepEqual(result, {
      level: 'notice',
      txn: '1',
      plugin: 'mail_from',
      message: 'sender ok',
    })
  })

  it('parses a line with a timestamp prefix', () => {
    const result = mod.parseLogLine('12:34:56 [WARN] [dnsbl] listed')
    assert.deepEqual(result, {
      level: 'warn',
      txn: '',
      plugin: 'dnsbl',
      message: 'listed',
    })
  })

  it('returns raw line as message for unrecognised format', () => {
    const result = mod.parseLogLine('not a valid log line')
    assert.equal(result.message, 'not a valid log line')
    assert.equal(result.level, '')
  })
})

describe('detectTransactions', () => {
  const L = (txn, code) =>
    `Nov  4 13:35:35 haraka haraka[1]: [NOTICE] ` +
    `[3E6A027F-8307-4DA4-B105-2A39EC4B58D4.${txn}] [core] queue code=${code} msg="x"`

  it('returns one entry per transaction, in order', () => {
    assert.deepEqual(mod.detectTransactions([L(2, 'DENY'), L(1, 'OK')]), [
      { txn: '1', disposition: 'delivered' },
      { txn: '2', disposition: 'blocked' },
    ])
  })

  it('maps every queue code', () => {
    assert.deepEqual(
      mod.detectTransactions([
        L(1, 'OK'),
        L(2, 'DENY'),
        L(3, 'TEMPFAIL'),
        L(4, 'DENYSOFT'),
        L(5, 'WAT'),
      ]),
      [
        { txn: '1', disposition: 'delivered' },
        { txn: '2', disposition: 'blocked' },
        { txn: '3', disposition: 'delayed' },
        { txn: '4', disposition: 'delayed' },
        { txn: '5', disposition: 'unknown' },
      ],
    )
  })

  it('returns [] when no queue lines present', () => {
    assert.deepEqual(mod.detectTransactions(['[INFO] [core] connected']), [])
  })

  it('handles a queue line with no txn suffix', () => {
    assert.deepEqual(mod.detectTransactions(['[INFO] [core] queue code=OK']), [
      { txn: '', disposition: 'delivered' },
    ])
  })

  const base = '0FDA5EE9-5A2E-4B00-A4E1-871D37E87BD7'
  const hook = (txn, retval) =>
    `Nov  4 13:35:35 haraka haraka[1]: [INFO] [${base}.${txn}] ` +
    `[core] hook=data plugin=karma function=hook_data params="" retval=${retval} msg="x"`
  const disc = (lr) =>
    `Nov  4 13:35:37 haraka haraka[1]: [NOTICE] [${base}] [core] ` +
    `disconnect ip=1.2.3.4 txns=1 rcpts=1/0/0 msgs=0/0/0 bytes=0 lr="${lr}" time=1`

  it('classifies a pre-queue hook DENY as blocked', () => {
    assert.deepEqual(mod.detectTransactions([hook(1, 'DENY')]), [
      { txn: '1', disposition: 'blocked' },
    ])
  })

  it('classifies a hook DENYSOFT as delayed', () => {
    assert.deepEqual(mod.detectTransactions([hook(1, 'DENYSOFT')]), [
      { txn: '1', disposition: 'delayed' },
    ])
  })

  it('queue outcome wins over an earlier hook retval', () => {
    assert.deepEqual(
      mod.detectTransactions([
        hook(1, 'DENY'),
        `Nov  4 13:35:35 haraka haraka[1]: [NOTICE] [${base}.1] [core] queue code=OK msg="x"`,
      ]),
      [{ txn: '1', disposition: 'delivered' }],
    )
  })

  it('falls back to the disconnect last-response when no per-txn signal', () => {
    assert.deepEqual(mod.detectTransactions([disc('554 5.7.1 blocked')]), [
      { txn: '', disposition: 'blocked' },
    ])
  })

  it('disconnect 4xx fallback is delayed', () => {
    assert.deepEqual(mod.detectTransactions([disc('451 try later')]), [
      { txn: '', disposition: 'delayed' },
    ])
  })

  it('per-txn signal takes precedence over the disconnect fallback', () => {
    assert.deepEqual(
      mod.detectTransactions([hook(1, 'DENY'), disc('554 blocked')]),
      [{ txn: '1', disposition: 'blocked' }],
    )
  })

  const connectDeny =
    `Nov  4 13:35:35 haraka haraka[1]: [INFO] [${base}] [core] ` +
    `hook=connect plugin=dns-list function=onConnect params="" retval=DENY msg="listed"`
  const overrideLine =
    `Nov  4 13:35:35 haraka haraka[1]: [INFO] [${base}] [core] ` +
    `deny(soft?) overriden by deny hook`
  const queueOK = `Nov  4 13:35:35 haraka haraka[1]: [NOTICE] [${base}.1] [core] queue code=OK msg="x"`

  it('ignores a DENY that was overridden by a deny hook', () => {
    assert.deepEqual(
      mod.detectTransactions([connectDeny, overrideLine, queueOK]),
      [{ txn: '1', disposition: 'delivered' }],
    )
  })

  it('keeps a DENY that occurs after the override', () => {
    assert.deepEqual(
      mod.detectTransactions([connectDeny, overrideLine, hook(1, 'DENY')]),
      [{ txn: '1', disposition: 'blocked' }],
    )
  })

  it('overridden connect DENY then terminal 550 -> blocked via lr', () => {
    assert.deepEqual(
      mod.detectTransactions([
        connectDeny,
        overrideLine,
        disc('550 I cannot deliver mail'),
      ]),
      [{ txn: '', disposition: 'blocked' }],
    )
  })

  const noMsgDisc = (lr) =>
    `Nov  4 13:35:37 haraka haraka[1]: [NOTICE] [${base}] [core] ` +
    `disconnect ip=1.2.3.4 txns=0 rcpts=0/0/0 msgs=0/0/0 bytes=0 lr="${lr}" time=1`

  it('reports "none" for a connect-only probe (txns=0, no response)', () => {
    assert.deepEqual(mod.detectTransactions([noMsgDisc('')]), [
      { txn: '', disposition: 'none' },
    ])
  })

  it('a 5xx with txns=0 is still blocked (rejected before DATA)', () => {
    assert.deepEqual(mod.detectTransactions([noMsgDisc('554 go away')]), [
      { txn: '', disposition: 'blocked' },
    ])
  })

  it('a 2xx/empty with txns=0 is "none", not a message outcome', () => {
    assert.deepEqual(mod.detectTransactions([noMsgDisc('250 OK')]), [
      { txn: '', disposition: 'none' },
    ])
  })
})

describe('asHtml connect-only probe', () => {
  beforeEach(() => {
    this.reader = new fixtures.plugin('index')
    this.reader.register()
  })

  it('does not claim a message outcome or blame the sender', async () => {
    const base = '0FDA5EE9-5A2E-4B00-A4E1-871D37E87BD7'
    const matched =
      `Nov  4 13:35:37 haraka haraka[1]: [NOTICE] [${base}] [core] ` +
      `disconnect ip=204.11.96.98 rdns=seattle.tnpi.net helo=nagios.tnpi.net ` +
      `relay=N early=N esmtp=N tls=N pipe=N errors=0 txns=0 rcpts=0/0/0 msgs=0/0/0 bytes=0 lr="" time=1.184`
    const html = await new Promise((resolve) =>
      this.reader.asHtml(base, matched, resolve),
    )
    assert.ok(/did not attempt to send/.test(html))
    assert.ok(!/could not determine/.test(html))
    assert.ok(!/mistaken your server/.test(html))
  })
})

describe('asHtml rejected connection', () => {
  beforeEach(() => {
    this.reader = new fixtures.plugin('index')
    this.reader.register()
  })

  it('shows blocked (not undetermined) for a data-hook DENY', async () => {
    const base = '0FDA5EE9-5A2E-4B00-A4E1-871D37E87BD7'
    const matched =
      `Nov  4 13:35:35 haraka haraka[1]: [INFO] [${base}.1] [core] hook=data plugin=karma function=hook_data params="" retval=DENY msg="x"\n` +
      `Nov  4 13:35:37 haraka haraka[1]: [NOTICE] [${base}] [core] disconnect ip=1.2.3.4 txns=1 rcpts=1/0/0 msgs=0/0/0 bytes=0 lr="554 blocked" time=1`
    const html = await new Promise((resolve) =>
      this.reader.asHtml(base, matched, resolve),
    )
    assert.ok(/alert-danger/.test(html))
    assert.ok(/was blocked/.test(html))
    assert.ok(!/could not determine/.test(html))
  })

  it('highlights the terminal line, not an overridden DENY', async () => {
    const base = '0FDA5EE9-5A2E-4B00-A4E1-871D37E87BD7'
    const rowClassFor = (html, marker) => {
      for (const part of html.split('<tr class="')) {
        const m = part.match(/^([^"]*)"/)
        if (m && part.includes(marker)) return m[1]
      }
      return null
    }
    const matched = [
      `Nov  4 13:35:35 haraka haraka[1]: [INFO] [${base}] [core] hook=connect plugin=dns-list function=onConnect params="" retval=DENY msg="listed on dnsbl.justspam.org"`,
      `Nov  4 13:35:35 haraka haraka[1]: [INFO] [${base}] [core] deny(soft?) overriden by deny hook`,
      `Nov  4 13:35:58 haraka haraka[1]: [NOTICE] [${base}.1] [core] disconnect ip=51.89.142.222 txns=1 rcpts=0/0/1 msgs=0/0/0 bytes=0 lr="550 I cannot deliver mail for <tommynash@thomasnash.com>" time=23`,
    ].join('\n')
    const html = await new Promise((r) => this.reader.asHtml(base, matched, r))
    const denyRow = rowClassFor(html, 'dnsbl.justspam.org')
    const termRow = rowClassFor(html, 'I cannot deliver mail')
    assert.ok(
      denyRow !== null && !/disposition-blocked/.test(denyRow),
      `overridden DENY row must not be blocked-highlighted (got "${denyRow}")`,
    )
    assert.ok(
      termRow !== null && /disposition-blocked/.test(termRow),
      `terminal 550 row must be blocked-highlighted (got "${termRow}")`,
    )
  })

  it('detects disposition through ANSI colour codes', async () => {
    const base = '0FDA5EE9-5A2E-4B00-A4E1-871D37E87BD7'
    // ESC sequence sits between [core] and "queue", which would defeat
    // the matcher unless lines are stripped before detection
    const matched =
      `Nov  4 13:35:35 haraka haraka[1]: \x1B[1m[NOTICE]\x1B[0m [${base}.1] ` +
      `\x1B[36m[core]\x1B[0m queue code=OK msg="ok"`
    const html = await new Promise((resolve) =>
      this.reader.asHtml(base, matched, resolve),
    )
    assert.ok(/was delivered/.test(html))
    assert.ok(!/could not determine/.test(html))
  })
})

describe('asHtml multi-transaction', () => {
  beforeEach(() => {
    this.reader = new fixtures.plugin('index')
    this.reader.register()
  })

  it('lists each message with its own disposition', async () => {
    const base = '3E6A027F-8307-4DA4-B105-2A39EC4B58D4'
    const matched =
      `Nov  4 13:35:35 haraka haraka[1]: [NOTICE] [${base}.1] [core] queue code=OK msg="ok"\n` +
      `Nov  4 13:35:36 haraka haraka[1]: [NOTICE] [${base}.2] [core] queue code=DENY msg="no"`
    const html = await new Promise((resolve) =>
      this.reader.asHtml(base, matched, resolve),
    )
    assert.ok(/list-group/.test(html), 'renders a per-message list')
    assert.ok(
      /list-group-item-success[^]*Message 1/.test(html),
      'message 1 delivered',
    )
    assert.ok(
      /list-group-item-danger[^]*Message 2/.test(html),
      'message 2 blocked',
    )
    // must NOT collapse to a single connection-wide verdict
    assert.ok(!/alert-success/.test(html))
  })
})

describe('detectDisposition', () => {
  it('returns "delivered" for queue code=OK', () => {
    const lines = ['[INFO] [core] queue code=OK pid=1']
    assert.equal(mod.detectDisposition(lines), 'delivered')
  })

  it('returns "blocked" for queue code=DENY', () => {
    const lines = ['[INFO] [core] queue code=DENY']
    assert.equal(mod.detectDisposition(lines), 'blocked')
  })

  it('returns "delayed" for queue code=TEMPFAIL', () => {
    const lines = ['[INFO] [core] queue code=TEMPFAIL']
    assert.equal(mod.detectDisposition(lines), 'delayed')
  })

  it('returns "delayed" for queue code=DENYSOFT', () => {
    const lines = ['[INFO] [core] queue code=DENYSOFT']
    assert.equal(mod.detectDisposition(lines), 'delayed')
  })

  it('returns "unknown" when no queue line present', () => {
    assert.equal(mod.detectDisposition(['[INFO] [core] connected']), 'unknown')
  })

  it('returns "unknown" for empty input', () => {
    assert.equal(mod.detectDisposition([]), 'unknown')
  })
})

describe('grepLog', () => {
  beforeEach(() => {
    this.reader = new fixtures.plugin('index')
    this.reader.register()
    this.reader.config = this.reader.config.module_config(path.resolve('test'))
    this.reader.load_karma_ini()
  })

  it('reads matching connection entries from a log file', async () => {
    const logfile = path.join('test', 'fixtures', 'haraka.log')
    await new Promise((resolve) => {
      this.reader.grepLog(
        logfile,
        '3E6A027F-8307-4DA4-B105-2A39EC4B58D4',
        (err, r) => {
          assert.ifError(err)
          // console.log(r);
          assert.equal(r.split('\n').length - 1, 36)
          resolve()
        },
      )
    })
  })

  it('reads matching transaction entries from a log file', async () => {
    const logfile = path.join('test', 'fixtures', 'haraka.log')
    await new Promise((resolve) => {
      this.reader.grepLog(
        logfile,
        '3E6A027F-8307-4DA4-B105-2A39EC4B58D4.1',
        (err, r) => {
          assert.ifError(err)
          // console.log(r);
          assert.equal(r.split('\n').length - 1, 36)
          resolve()
        },
      )
    })
  })

  it('formats matching entries as HTML', async () => {
    const uuid = '3E6A027F-8307-4DA4-B105-2A39EC4B58D4.1'
    const logfile = path.join('test', 'fixtures', 'haraka.log')
    await new Promise((resolve) => {
      this.reader.grepLog(logfile, uuid, (err, r) => {
        assert.ifError(err)
        this.reader.asHtml(uuid, r, (html) => {
          // console.log(html);
          assert.ok(/^<html>/.test(html))
          assert.ok(/<\/html>$/.test(html))
          resolve()
        })
      })
    })
  })
})

describe('asHtml', () => {
  beforeEach(() => {
    this.reader = new fixtures.plugin('index')
    this.reader.register()
    this.reader.config = this.reader.config.module_config(path.resolve('test'))
    this.reader.load_karma_ini()
  })

  it('formats a block of log lines for HTML presentation', async () => {
    const uuid = '9613CD00-7145-4ABC-8CA8-79CD9E39BB4F'
    const logfile = path.join('test', 'fixtures', 'haraka.log')
    await new Promise((resolve) => {
      this.reader.grepLog(logfile, uuid, (err, r) => {
        this.reader.asHtml(uuid, r, (html) => {
          assert.ok(/^<html>/.test(html))
          assert.ok(/<\/html>/.test(html))
          // console.log(html);
          resolve()
        })
      })
    })
  })

  it('shows delivered alert for queue code=OK', async () => {
    const uuid = '3E6A027F-8307-4DA4-B105-2A39EC4B58D4.1'
    const logfile = path.join('test', 'fixtures', 'haraka.log')
    await new Promise((resolve) => {
      this.reader.grepLog(logfile, uuid, (err, r) => {
        this.reader.asHtml(uuid, r, (html) => {
          assert.ok(/alert-success/.test(html))
          assert.ok(/was delivered/.test(html))
          resolve()
        })
      })
    })
  })

  it('renders a table with thead and tbody', async () => {
    const uuid = '3E6A027F-8307-4DA4-B105-2A39EC4B58D4.1'
    const logfile = path.join('test', 'fixtures', 'haraka.log')
    await new Promise((resolve) => {
      this.reader.grepLog(logfile, uuid, (err, r) => {
        this.reader.asHtml(uuid, r, (html) => {
          assert.ok(/<table/.test(html))
          assert.ok(/<thead>/.test(html))
          assert.ok(/<tbody>/.test(html))
          resolve()
        })
      })
    })
  })
})

describe('asHtml UUID stripping', () => {
  beforeEach(() => {
    this.reader = new fixtures.plugin('index')
    this.reader.register()
  })

  it('strips the canonical UUID token from the message', async () => {
    const line =
      'Nov  4 13:35:35 haraka haraka[1]: [INFO] ' +
      '[3E6A027F-8307-4DA4-B105-2A39EC4B58D4] [core] hello world'
    const html = await new Promise((resolve) =>
      this.reader.asHtml('9613CD00-7145-4ABC-8CA8-79CD9E39BB4F', line, resolve),
    )
    assert.ok(/>hello world<\/td>/.test(html))
    assert.ok(!/3E6A027F-8307-4DA4-B105-2A39EC4B58D4/.test(html))
  })

  it('does not strip a non-UUID [..I] token (regression for stray i?)', async () => {
    // the old /[A-F0-9.-]{12,40}i?\] /i wrongly consumed a trailing I
    const line =
      'Nov  4 13:35:35 haraka haraka[1]: [INFO] ' +
      '[ABCDEF012345I] [core] kept'
    const html = await new Promise((resolve) =>
      this.reader.asHtml('9613CD00-7145-4ABC-8CA8-79CD9E39BB4F', line, resolve),
    )
    assert.ok(/ABCDEF012345I/.test(html))
  })
})

describe('asHtml row highlighting', () => {
  beforeEach(() => {
    this.reader = new fixtures.plugin('index')
    this.reader.register()
  })

  it('marks queue code=OK row as disposition-delivered', async () => {
    const base = 'AABBCCDD-1234-5678-9ABC-DDEEFF001122'
    const line = `Nov  4 13:35:35 haraka haraka[1]: [NOTICE] [${base}.1] [core] queue code=OK msg="ok"`
    const html = await new Promise((resolve) =>
      this.reader.asHtml(base, line, resolve),
    )
    assert.ok(/class="disposition-delivered"/.test(html))
  })

  it('marks queue code=DENY row as disposition-blocked', async () => {
    const base = 'AABBCCDD-1234-5678-9ABC-DDEEFF001122'
    const line = `Nov  4 13:35:35 haraka haraka[1]: [NOTICE] [${base}.1] [core] queue code=DENY msg="no"`
    const html = await new Promise((resolve) =>
      this.reader.asHtml(base, line, resolve),
    )
    assert.ok(/class="disposition-blocked"/.test(html))
  })

  it('marks a retval=DENY hook line as disposition-blocked', async () => {
    const base = 'AABBCCDD-1234-5678-9ABC-DDEEFF001122'
    const line = `Nov  4 13:35:35 haraka haraka[1]: [INFO] [${base}.1] [core] hook=data plugin=karma function=hook_data params="" retval=DENY msg="x"`
    const html = await new Promise((resolve) =>
      this.reader.asHtml(base, line, resolve),
    )
    assert.ok(/class="disposition-blocked"/.test(html))
  })

  it('marks a positive-score karma line as karma-positive', async () => {
    const base = 'AABBCCDD-1234-5678-9ABC-DDEEFF001122'
    const line = `Nov  4 13:35:35 haraka haraka[1]: [INFO] [${base}] [karma] score: 5, good: 3, bad: 0`
    const html = await new Promise((resolve) =>
      this.reader.asHtml(base, line, resolve),
    )
    assert.ok(/class="karma-positive"/.test(html))
  })

  it('marks a negative-score karma line as karma-negative', async () => {
    const base = 'AABBCCDD-1234-5678-9ABC-DDEEFF001122'
    const line = `Nov  4 13:35:35 haraka haraka[1]: [INFO] [${base}] [karma] score: -3, good: 0, bad: 2`
    const html = await new Promise((resolve) =>
      this.reader.asHtml(base, line, resolve),
    )
    assert.ok(/class="karma-negative"/.test(html))
  })

  it('does not highlight a zero-score karma line specially', async () => {
    const base = 'AABBCCDD-1234-5678-9ABC-DDEEFF001122'
    const line = `Nov  4 13:35:35 haraka haraka[1]: [INFO] [${base}] [karma] score: 0, good: 0, bad: 0`
    const html = await new Promise((resolve) =>
      this.reader.asHtml(base, line, resolve),
    )
    assert.ok(!/<tr class="karma-positive"/.test(html))
    assert.ok(!/<tr class="karma-negative"/.test(html))
  })
})

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code
      return this
    },
    send(body) {
      this.body = body
      return this
    },
  }
}

describe('get_logs input validation', () => {
  // haraka-test-fixtures loads a package.json plugin via real require(),
  // so get_logs calls the *module's* exports.grepLog -- stubbing the
  // plugin instance copy would not intercept it. Stub the shared module
  // object and restore it.
  let origGrepLog
  let origAsHtml

  beforeEach(() => {
    this.reader = new fixtures.plugin('index')
    this.reader.register()
    // never let validation tests touch the real grep/log
    this.grepCalls = []
    origGrepLog = mod.grepLog
    origAsHtml = mod.asHtml
    mod.grepLog = (file, uuid, done) => {
      this.grepCalls.push(uuid)
      done(null, '')
    }
    mod.asHtml = (uuid, matched, done) => done('<html></html>')
  })

  afterEach(() => {
    mod.grepLog = origGrepLog
    mod.asHtml = origAsHtml
  })

  it('accepts a canonical Haraka UUID', () => {
    const res = mockRes()
    this.reader.get_logs(
      { params: { uuid: '3E6A027F-8307-4DA4-B105-2A39EC4B58D4' } },
      res,
    )
    assert.equal(res.statusCode, 200)
    assert.equal(this.grepCalls.length, 1)
  })

  it('accepts a canonical UUID with transaction suffix', () => {
    const res = mockRes()
    this.reader.get_logs(
      { params: { uuid: '3E6A027F-8307-4DA4-B105-2A39EC4B58D4.12' } },
      res,
    )
    assert.equal(res.statusCode, 200)
    assert.equal(this.grepCalls.length, 1)
  })

  it('rejects a crafted regex-wildcard uuid (no grep invocation)', () => {
    const res = mockRes()
    // passes the old loose /^[0-9A-F\-.]{12,40}$/i but is a grep pattern
    // that would wildcard-match unrelated connections' log lines
    this.reader.get_logs(
      { params: { uuid: '........-....-....-....-............' } },
      res,
    )
    assert.equal(res.statusCode, 400)
    assert.equal(this.grepCalls.length, 0)
  })

  it('rejects a leading-dash (grep arg-injection) uuid', () => {
    const res = mockRes()
    this.reader.get_logs({ params: { uuid: '--------------------' } }, res)
    assert.equal(res.statusCode, 400)
    assert.equal(this.grepCalls.length, 0)
  })

  it('rejects a uuid with no dashes', () => {
    const res = mockRes()
    this.reader.get_logs({ params: { uuid: 'deadbeefdeadbeef' } }, res)
    assert.equal(res.statusCode, 400)
    assert.equal(this.grepCalls.length, 0)
  })
})

describe('get_rules', () => {
  beforeEach(() => {
    this.reader = new fixtures.plugin('index')
    this.reader.register()
    this.reader.result_awards = { 1: { award: -7, reason: 'test' } }
  })

  it('is forbidden by default (secure by default)', () => {
    const res = mockRes()
    this.reader.get_rules({}, res)
    assert.equal(res.statusCode, 403)
    assert.ok(/Forbidden/.test(res.body))
  })

  it('stays forbidden when explicitly disabled', () => {
    this.reader.cfg.main.allow_rules_endpoint = false
    const res = mockRes()
    this.reader.get_rules({}, res)
    assert.equal(res.statusCode, 403)
  })

  it('serves rules JSON only when explicitly enabled', () => {
    this.reader.cfg.main.allow_rules_endpoint = true
    const res = mockRes()
    this.reader.get_rules({}, res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(JSON.parse(res.body), {
      1: { award: -7, reason: 'test' },
    })
  })
})
