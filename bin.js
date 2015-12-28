#!/usr/bin/env node

var discovery = require('./')
var minimist = require('minimist')

var argv = minimist(process.argv.slice(2), {
  alias: {port: 'p', host: 'h', tracker: 't'}
})

var cmd = argv._[0]
var disc

if (cmd === 'listen') {
  disc = discovery(argv)
  disc.listen(argv.port, onlisten)
} else if (cmd === 'lookup') {
  disc = discovery(argv)
  disc.on('peer', console.log)
  disc.lookup(argv._[1])
} else if (cmd === 'announce') {
  disc = discovery(argv)
  if (!argv.port) throw new Error('You need to specify --port')
  disc.announce(argv._[1], argv)
} else {
  console.error(
    'dns-discovery [command]\n' +
    '  announce [name]\n' +
    '    --port=(port)\n' +
    '    --host=(optional host)\n' +
    '    --peer=(optional peer-id)\n' +
    '    --tracker=(optional tracker)\n' +
    '  lookup [name]\n' +
    '     --tracker=(optional tracker)\n' +
    '  listen\n' +
    '     --port=(optional port)\n' +
    '     --ttl=(optional ttl in seconds)\n'
  )
  process.exit(1)
}

function onlisten (err) {
  if (err) throw err
  console.log('Server is listening on port %d', argv.port || 53)
}
