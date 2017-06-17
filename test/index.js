'use strict';

process.env.NODE_ENV = 'test';

var assert   = require('assert');
// var fs       = require('fs');
var path     = require('path');

var fixtures = require('haraka-test-fixtures');

describe('register', function () {
  var attach = new fixtures.plugin('index');

  it('is a function', function (done) {
    assert.equal('function', typeof attach.register);
    done();
  });

  it('runs', function (done) {
    attach.register();
    // console.log(attach.cfg);
    done();
  });

  it('loads log.reader.ini', function (done) {
    attach.register();
    assert.deepEqual(attach.cfg, {
      main: {},
      log: {
        file: '/var/log/haraka.log'
      }
    });
    done();
  });

  it('loads karma.ini', function (done) {
    attach.register();
    assert.equal(attach.karma_cfg.tarpit.delay, 0);
    done();
  });
});

describe('log.reader.ini', function () {
  var reader = new fixtures.plugin('index');

  it('has a log section', function (done) {
    reader.register();
    assert.ok(reader.cfg.log.file);
    done();
  });
});

describe('grepWithShell', function () {
  it('reads matching connection entries from a log file', function (done) {
    var reader = new fixtures.plugin('index');
    reader.register();

    var logfile = path.join('test','fixtures','haraka.log');
    reader.grepWithShell(logfile, '3E6A027F-8307-4DA4-B105-2A39EC4B58D4', function (err, r) {
      assert.ifError(err);
      // console.log(r);
      assert.equal(r.split('\n').length - 1, 36);
      done();
    });
  });

  it('reads matching transaction entries from a log file', function (done) {
    var reader = new fixtures.plugin('index');
    reader.register();

    var logfile = path.join('test','fixtures','haraka.log');
    reader.grepWithShell(logfile, '3E6A027F-8307-4DA4-B105-2A39EC4B58D4.1', function (err, r) {
      assert.ifError(err);
      // console.log(r);
      assert.equal(r.split('\n').length - 1, 36);
      done();
    });
  });

  it('formats matching entries as HTML', function (done) {
    var reader = new fixtures.plugin('index');
    reader.register();

    var uuid = '3E6A027F-8307-4DA4-B105-2A39EC4B58D4.1';
    var logfile = path.join('test','fixtures','haraka.log');
    reader.grepWithShell(logfile, uuid, function (err, r) {
      assert.ifError(err);
      reader.asHtml(uuid, r, function (html) {
        // console.log(html);
        assert.ok(/^<html>/.test(html));
        assert.ok(/<\/html>$/.test(html));
        done();
      });
    });
  });
});

// the subsequent functions require the express res/req
// those could be mocked up, along with some sample log files

describe('get_rules', function () {
  it.skip('returns rules section from karma.ini', function (done) {
    done();
  })
});
