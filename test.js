var dgram = require('dgram')
var tape = require('tape')
var discovery = require('./')

freePort(function (port) {
  tape('discovers', function (t) {
    var disc = discovery()
    var ns = Math.random().toString(16) + '-' + process.pid
    var appName = 'dns-discovery-' + ns

    disc.on('peer', function (name, peer) {
      disc.destroy()
      t.same(name, appName)
      t.same(peer, {id: 'a-peer-id', host: '127.0.0.1', port: 8080})
      t.end()
    })

    disc.announce(appName, {id: 'a-peer-id', port: 8080, host: '127.0.0.1'})
    disc.lookup(appName)
  })

  tape('discovers only using tracker', function (t) {
    t.plan(4)

    var tracker = discovery({multicast: false})
    var client = discovery({multicast: false, tracker: 'localhost:' + port})

    tracker.on('peer', function (name, peer) {
      t.same(name, 'hello-world')
      t.same(peer, {id: 'a-peer-id', host: '127.0.0.1', port: 8080})
    })

    client.on('peer', function (name, peer) {
      t.same(name, 'hello-world')
      t.same(peer, {id: 'a-peer-id', host: '127.0.0.1', port: 8080})
      tracker.destroy()
      client.destroy()
    })

    tracker.listen(port, function () {
      client.announce('hello-world', {port: 8080, id: 'a-peer-id', host: '127.0.0.1'}, function () {
        client.lookup('hello-world')
      })
    })
  })

  tape('limit', function (t) {
    var tracker = discovery({multicast: false, limit: 1})

    tracker.announce('hello-world', {port: 8080, id: 'a-peer-id', host: '127.0.0.1'})
    tracker.announce('hello-world-2', {port: 8081, id: 'a-peer-id', host: '127.0.0.1'})

    var domains = tracker.toJSON()
    t.same(domains.length, 1)
    t.same(domains[0].records.length, 1)
    t.end()
  })
})

function freePort (cb) {
  var socket = dgram.createSocket('udp4')
  socket.bind(0, function () {
    socket.on('close', cb.bind(null, socket.address().port))
    socket.close()
  })
}
