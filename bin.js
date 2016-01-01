#!/usr/bin/env node

var pkg = require('./package.json')
require('@maboiteaspam/set-verbosity')(pkg.name, process.argv)
var discovery = require('./')
var minimist = require('minimist')

var argv = minimist(process.argv.slice(2), {
  alias: {port: 'p', host: 'h', tracker: 't'}
})

var rcvd = {}
var cmd = argv._[0]
var disc = discovery(argv)

if (cmd === 'listen') {
  disc.listen(argv.port, onlisten)
} else if (cmd === 'lookup') {
  disc.on('peer', onpeer)
  lookup()
  setInterval(lookup, argv.heartbeat || 1000)
} else if (cmd === 'announce') {
  if (!argv.port) throw new Error('You need to specify --port')
  announce()
  setInterval(announce, argv.heartbeat || 1000)
} else {
  console.error(
    'dns-discovery [command]\n' +
    '  announce [name]\n' +
    '    --port=(port)\n' +
    '    --host=(optional host)\n' +
    '    --peer=(optional peer-id)\n' +
    '    --tracker=(optional tracker)\n' +
    '    --heartbeat=(time interval in milliseconds)\n' +
    '  lookup [name]\n' +
    '    --tracker=(optional tracker)\n' +
    '    --heartbeat=(time interval in milliseconds)\n' +
    '  listen\n' +
    '    --port=(optional port)\n' +
    '    --ttl=(optional ttl in seconds)\n' +
    '\n' +
    '  -v|--verbose=(optional modules)\n'
  )
  process.exit(1)
}

function lookup () {
  disc.lookup(argv._[1])
}

function announce () {
  disc.announce(argv._[1], argv)
}

function onpeer (name, peer) {
  var addr = peer.host + ':' + peer.host
  if (rcvd[addr]) return
  rcvd[addr] = true
  console.log(name, peer)
}

function onlisten (err) {
  if (err) throw err
  console.log('Server is listening on port %d', argv.port || 53)
}
