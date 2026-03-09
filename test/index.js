'use strict'

process.env.NODE_ENV = 'test'

const assert = require('node:assert')
const path = require('node:path')

const fixtures = require('haraka-test-fixtures')

beforeEach(() => {
  this.reader = new fixtures.plugin('index')

  // Conditionally inject for coverage tracking
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
      main: {},
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

describe('grepWithShell', () => {
  beforeEach(() => {
    this.reader = new fixtures.plugin('index')
    this.reader.register()
    this.reader.config = this.reader.config.module_config(path.resolve('test'))
    this.reader.load_karma_ini()
  })

  it('reads matching connection entries from a log file', () => {
    const logfile = path.join('test', 'fixtures', 'haraka.log')
    this.reader.grepWithShell(
      logfile,
      '3E6A027F-8307-4DA4-B105-2A39EC4B58D4',
      (err, r) => {
        assert.ifError(err)
        // console.log(r);
        assert.equal(r.split('\n').length - 1, 36)
      },
    )
  })

  it('reads matching transaction entries from a log file', () => {
    const logfile = path.join('test', 'fixtures', 'haraka.log')
    this.reader.grepWithShell(
      logfile,
      '3E6A027F-8307-4DA4-B105-2A39EC4B58D4.1',
      (err, r) => {
        assert.ifError(err)
        // console.log(r);
        assert.equal(r.split('\n').length - 1, 36)
      },
    )
  })

  it('formats matching entries as HTML', () => {
    const uuid = '3E6A027F-8307-4DA4-B105-2A39EC4B58D4.1'
    const logfile = path.join('test', 'fixtures', 'haraka.log')
    this.reader.grepWithShell(logfile, uuid, (err, r) => {
      assert.ifError(err)
      this.reader.asHtml(uuid, r, (html) => {
        // console.log(html);
        assert.ok(/^<html>/.test(html))
        assert.ok(/<\/html>$/.test(html))
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

  it('formats a block of log lines for HTML presentation', () => {
    const uuid = '9613CD00-7145-4ABC-8CA8-79CD9E39BB4F'
    const logfile = path.join('test', 'fixtures', 'haraka.log')
    this.reader.grepWithShell(logfile, uuid, (err, r) => {
      this.reader.asHtml(uuid, r, (html) => {
        assert.ok(/^<html>/.test(html))
        assert.ok(/<\/html>/.test(html))
        // console.log(html);
      })
    })
  })
})

// the subsequent functions require the express res/req
// those could be mocked up, along with some sample log files

describe('get_rules', () => {
  it.skip('returns rules section from karma.ini', () => {})
})
