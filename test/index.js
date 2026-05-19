'use strict'

process.env.NODE_ENV = 'test'

const assert = require('node:assert')
const path = require('node:path')
const { describe, it, beforeEach } = require('node:test')

const fixtures = require('haraka-test-fixtures')

beforeEach(() => {
  this.reader = new fixtures.plugin('index')

  // replace vm-compiled functions with instrumented versions for coverage tracking
  if (process.env.HARAKA_COVERAGE) {
    const plugin_module = require('../index.js')
    Object.assign(this.reader, plugin_module)
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
  beforeEach(() => {
    this.reader = new fixtures.plugin('index')
    this.reader.register()
    // never let validation tests touch the real grep/log
    this.grepCalls = []
    this.reader.grepLog = (file, uuid, done) => {
      this.grepCalls.push(uuid)
      done(null, '')
    }
    this.reader.asHtml = (uuid, matched, done) => done('<html></html>')
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
