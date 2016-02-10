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
      t.same(peer, {host: '127.0.0.1', port: 8080, local: true})
      t.end()
    })

    disc.announce(appName, {port: 8080, host: '127.0.0.1'})
    disc.lookup(appName)
  })

  tape('discovers only using server', function (t) {
    t.plan(4)

    var server = discovery({multicast: false})
    var client = discovery({multicast: false, server: 'localhost:' + port})

    server.on('peer', function (name, peer) {
      t.same(name, 'hello-world')
      t.same(peer, {host: '127.0.0.1', port: 8080, local: false})
    })

    client.on('peer', function (name, peer) {
      t.same(name, 'hello-world')
      t.same(peer, {host: '127.0.0.1', port: 8080, local: false})
      server.destroy()
      client.destroy()
    })

    server.listen(port, function () {
      client.announce('hello-world', {port: 8080, host: '127.0.0.1'}, function () {
        client.lookup('hello-world')
      })
    })
  })

  tape('discovers only using multiple servers', function (t) {
    t.plan(6)

    var server = discovery({multicast: false})
    var client = discovery({multicast: false, server: ['localhost:' + port, 'localhost:' + port]})

    server.on('peer', function (name, peer) {
      t.same(name, 'hello-world')
      t.same(peer, {host: '127.0.0.1', port: 8080, local: false})
    })

    client.on('peer', function (name, peer) {
      t.same(name, 'hello-world')
      t.same(peer, {host: '127.0.0.1', port: 8080, local: false})
      server.destroy()
      client.destroy()
    })

    server.listen(port, function () {
      client.announce('hello-world', {port: 8080, host: '127.0.0.1'}, function () {
        client.lookup('hello-world')
      })
    })
  })

  tape('limit', function (t) {
    var server = discovery({multicast: false, limit: 1})

    server.announce('hello-world', {port: 8080, host: '127.0.0.1'})
    server.announce('hello-world-2', {port: 8081, host: '127.0.0.1'})

    var domains = server.toJSON()
    t.same(domains.length, 1)
    t.same(domains[0].records.length, 1)
    t.end()
  })

  tape('push', function (t) {
    var server = discovery({multicast: false, push: true})
    var client1 = discovery({multicast: false, server: 'localhost:' + port})
    var client2 = discovery({multicast: false, server: 'localhost:' + port})

    server.listen(port, function () {
      server.once('peer', function () {
        client2.announce('hello-world', 8081)
      })
      client1.lookup('hello-world')
      client1.announce('hello-world', 8080)
      client1.on('peer', function (id, peer) {
        if (peer.port === 8081) {
          client1.destroy()
          client2.destroy()
          server.destroy()
          t.pass('got peer')
          t.end()
        }
      })
    })
  })
})

function freePort (cb) {
  var socket = dgram.createSocket('udp4')
  socket.bind(0, function () {
    socket.on('close', cb.bind(null, socket.address().port))
    socket.close()
  })
}
