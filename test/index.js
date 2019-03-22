'use strict';

process.env.NODE_ENV = 'test';

const assert   = require('assert');
const path     = require('path');

const fixtures = require('haraka-test-fixtures');

beforeEach((done) => {
  this.reader = new fixtures.plugin('index')
  done()
})

describe('register', () => {

  it('is a function', (done) => {
    assert.equal('function', typeof this.reader.register)
    done()
  })

  it('runs', (done) => {
    this.reader.register()
    // console.log(reader.cfg)
    done()
  })

  it('loads log.reader.ini', (done) => {
    this.reader.register()
    assert.deepEqual(this.reader.cfg, {
      main: {},
      log: {
        file: '/var/log/haraka.log'
      }
    })
    done()
  })

  it('loads karma.ini', (done) => {
    this.reader.register()
    this.reader.config = this.reader.config.module_config(path.resolve('test'));
    this.reader.load_karma_ini()
    assert.equal(this.reader.karma_cfg.tarpit.delay, 0)
    done()
  })
})

describe('log.reader.ini', () => {
  it('has a log section', (done) => {
    this.reader.register()
    assert.ok(this.reader.cfg.log.file)
    done()
  })
})

describe('grepWithShell', () => {

  beforeEach((done) => {
    this.reader = new fixtures.plugin('index')
    this.reader.register();
    this.reader.config = this.reader.config.module_config(path.resolve('test'));
    this.reader.load_karma_ini()
    done()
  })

  it('reads matching connection entries from a log file', (done) => {
    const logfile = path.join('test','fixtures','haraka.log');
    this.reader.grepWithShell(logfile, '3E6A027F-8307-4DA4-B105-2A39EC4B58D4', (err, r) => {
      assert.ifError(err);
      // console.log(r);
      assert.equal(r.split('\n').length - 1, 36);
      done();
    })
  })

  it('reads matching transaction entries from a log file', (done) => {
    const logfile = path.join('test','fixtures','haraka.log');
    this.reader.grepWithShell(logfile, '3E6A027F-8307-4DA4-B105-2A39EC4B58D4.1', (err, r) => {
      assert.ifError(err);
      // console.log(r);
      assert.equal(r.split('\n').length - 1, 36);
      done();
    })
  })

  it('formats matching entries as HTML', (done) => {
    const uuid = '3E6A027F-8307-4DA4-B105-2A39EC4B58D4.1';
    const logfile = path.join('test','fixtures','haraka.log');
    this.reader.grepWithShell(logfile, uuid, (err, r) => {
      assert.ifError(err);
      this.reader.asHtml(uuid, r, (html) => {
        // console.log(html);
        assert.ok(/^<html>/.test(html));
        assert.ok(/<\/html>$/.test(html));
        done();
      })
    })
  })
})

describe('asHtml', () => {
  beforeEach((done) => {
    this.reader = new fixtures.plugin('index')
    this.reader.register();
    this.reader.config = this.reader.config.module_config(path.resolve('test'));
    this.reader.load_karma_ini()
    done()
  })

  it('formats a block of log lines for HTML presentation', (done) => {
    const uuid = '9613CD00-7145-4ABC-8CA8-79CD9E39BB4F'
    const logfile = path.join('test','fixtures','haraka.log');
    this.reader.grepWithShell(logfile, uuid, (err, r) => {
      this.reader.asHtml(uuid, r, (html) => {
        assert.ok(/^<html>/.test(html))
        assert.ok(/<\/html>/.test(html))
        // console.log(html);
        done()
      })
    })
  })
})

// the subsequent functions require the express res/req
// those could be mocked up, along with some sample log files

describe('get_rules', () => {
  it.skip('returns rules section from karma.ini', (done) => {
    done();
  })
})
