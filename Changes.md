
### Unreleased


### [1.0.12] - 2022-06-05

- ci: update GHA workflow with shared
- ci: add submodule .release


### 1.0.11 - 2022-03-31

- node 12 EOL, drop testing.


### 1.0.10 - 2019-03-22

* Add an 'if' to "blocked message" HTML header
* CI testing updates (node.js versions)
* moved config/karma.ini to test/config/karma.ini


### 1.0.9 - 2017-08-17

* also prune syslog hostname when no PID in entry


### 1.0.8 - 2017-06-16

* depend on haraka-eslint for rules
* lint fixes


### 1.0.7 - 2017-05-04

* add --text flag to grep call, in case log file has binary chars


### 1.0.6 - 2017-01-23

* remove host & pid detail from syslog lines


### 1.0.5 - 2016-11-04

* display log entries for transactions
* display just transaction ID in place of full UUID.id
* refactored most of get logs into grepWithShell & asHtml
    * with test coverage for the latter two


### 1.0.4 - 2016-10-25

* remove useless $UUID token from display


### Oct 2 12:57:42 2016

* trim uuids more reliably (#4)


### Oct 2 12:08:44 2016

* Duplicate resolutions (#2)
* suppress duplicate actions


### Sep 29 23:10:33 2016

* add missing eslint definition
* added README
* add .travis.yml
* initial commit


[1.0.12]: https://github.com/haraka/haraka-plugin-log-reader/releases/tag/1.0.12
