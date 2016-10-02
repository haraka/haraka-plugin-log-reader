[![Build Status][ci-img]][ci-url]
[![Code Coverage][cov-img]][cov-url]
[![Code Climate][clim-img]][clim-url]

# haraka-plugin-log-reader

extracts matching log entries from haraka log files


# Install


````
npm install -g haraka-plugin-log-reader
````


## Enable

Add `haraka-plugin-log-reader` to your Haraka `config/plugins` file.


# Usage

When enabled, this plugin registers two URL routes in Haraka's http server:

* karma/rules
* /logs/:uuid

The former rule simply returns a list of the Haraka rules in use. The http client uses those rules (the ID, reason, and value) to display the `Policy Rules` and `Steps to Resolve` sections in the web page.

# Example


### Sorry we blocked your message:

Our filters mistook your server for a malicious computer attempting to send spam. To improve your mail servers reputation, please contact your IT helpdesk or Systems Administrator and ask them for help.

----------

### Policy Rules

* -7,  DNS Blacklist (b.barracudacentral.org)
* -5,  DNS Blacklist (zen.spamhaus.org)
* -3,  DNS Blacklist (dnsbl-1.uceprotect.net)
* -3,  DNS Blacklist (bl.spamcop.net)
* -3,  ASN reputation is spam-only (asn_all_bad)
* -1,  Geographic distance is unusual for ham (4000)
* -1,  Geographic distance is unusual for ham (8000)
* -1,  ASN reputation is bad (karma)

----------

### Steps to Resolve

* Disinfect your host/network

----------

## Raw Logs

4D0B74C5-6D41-4074-9E43-5EE9CC1B4973

<html><pre>
[NOTICE] [core] connect ip=95.160.74.108 port=39005 local_ip=172.16.15.9 local_port=25
[INFO] [connect.p0f] os="Linux 2.4.x-2.6.x" link_type="Ethernet or modem" distance=7 total_conn=1
[INFO] [connect.fcrdns] ip=95.160.74.108 rdns="095160074108.gdansk.vectranet.pl" rdns_len=1 fcrdns="095160074108.gdansk.vectranet.pl" fcrdns_len=1 other_ips_len=0 invalid_tlds=0 generic_rdns=true
[INFO] [connect.asn] asn: 29314, org: Al. Zwyciestwa 253, 81-525 Gdynia, Poland
[INFO] [connect.geoip] EU, PL, Gdansk, 82, 8506km
[INFO] [dnsbl] fail:dnsbl-1.uceprotect.net, bl.spamcop.net, b.barracudacentral.org, zen.spamhaus.org, dnsbl.sorbs.net
[INFO] [connect.asn] asn: 29314, org: Al. Zwyciestwa 253, 81-525 Gdynia, Poland, asn_score: -4364, asn_connections: 4367, asn_good: 0, asn_bad: 4364, fail:karma, asn_all_bad
[INFO] [limit] no IP history from : karma
[INFO] [karma] score: -24, awards: 001,002,115,114,111,116,021,023
[NOTICE] [core] disconnect ip=95.160.74.108 rdns="095160074108.gdansk.vectranet.pl" helo="" relay=N early=N esmtp=N tls=N pipe=N errors=0 txns=0 rcpts=0/0/0 msgs=0/0/0 bytes=0 lr="" time=12.752
</pre></html>


[ci-img]: https://travis-ci.org/haraka/haraka-plugin-log-reader.svg
[ci-url]: https://travis-ci.org/haraka/haraka-plugin-log-reader
[cov-img]: https://codecov.io/github/haraka/haraka-plugin-log-reader/coverage.svg
[cov-url]: https://codecov.io/github/haraka/haraka-plugin-log-reader
[clim-img]:
https://codeclimate.com/github/haraka/haraka-plugin-log-reader/badges/gpa.svg
[clim-url]: https://codeclimate.com/github/haraka/haraka-plugin-log-reader
[npm-img]: https://nodei.co/npm/haraka-plugin-log-reader.png
[npm-url]: https://www.npmjs.com/package/haraka-plugin-log-reader
