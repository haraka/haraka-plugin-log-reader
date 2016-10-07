'use strict';

process.env.NODE_ENV = 'test';

var assert   = require('assert');
// var fs       = require('fs');
// var path     = require('path');

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

// the subsequent functions require the express res/req
// those could be mocked up, along with some sample log files

describe('get_logs', function() {
  it.skip('reads entries from a log file', function (done) {
    done();
  })
});

describe('get_rules', function() {
  it.skip('returns rules section from karma.ini', function (done) {
    done();
  })
});
