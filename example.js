var discovery = require('dns-discovery')

var disc = discovery()

disc.on('peer', function (name, peer) {
  console.log(name, peer)
})

disc.announce('test', 4244)
disc.lookup('test')
