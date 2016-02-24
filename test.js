var dgram = require('dgram')
var tape = require('tape')
var discovery = require('./')

freePort(function (port) {
  tape('discovers', function (t) {
    var disc1 = discovery()
    var disc2 = discovery()
    var ns = Math.random().toString(16) + '-' + process.pid
    var appName = 'dns-discovery-' + ns

    disc2.on('peer', function (name, peer) {
      disc1.destroy()
      disc2.destroy()
      t.same(name, appName)
      t.same(peer.port, 8080)
      t.same(typeof peer.host, 'string')
      t.end()
    })

    disc1.announce(appName, 8080)
  })

  tape('discovers only using server', function (t) {
    t.plan(4)

    var server = discovery({multicast: false})
    var client2 = discovery({multicast: false, server: 'localhost:' + port})
    var client1 = discovery({multicast: false, server: 'localhost:' + port})

    server.on('peer', function (name, peer) {
      t.same(name, 'hello-world')
      t.same(peer.port, 8080)
    })

    client2.on('peer', function (name, peer) {
      t.same(name, 'hello-world')
      t.same(peer.port, 8080)
      server.destroy()
      client1.destroy()
      client2.destroy()
    })

    server.listen(port, function () {
      client1.announce('hello-world', 8080, function () {
        client2.lookup('hello-world')
      })
    })
  })

  tape('discovers only using server with secondary port', function (t) {
    t.plan(4)

    var server = discovery({multicast: false})
    var client2 = discovery({multicast: false, server: 'localhost:9999,' + port})
    var client1 = discovery({multicast: false, server: 'localhost:9998,' + port})

    server.on('peer', function (name, peer) {
      t.same(name, 'hello-world')
      t.same(peer.port, 8080)
    })

    client2.on('peer', function (name, peer) {
      t.same(name, 'hello-world')
      t.same(peer.port, 8080)
      server.destroy()
      client1.destroy()
      client2.destroy()
    })

    server.listen(port, function () {
      client1.announce('hello-world', 8080, function () {
        client2.lookup('hello-world')
      })
    })
  })

  tape('discovers only using multiple servers', function (t) {
    t.plan(6)

    var server = discovery({multicast: false})
    var client1 = discovery({multicast: false, server: ['localhost:' + port, 'localhost:' + port]})
    var client2 = discovery({multicast: false, server: ['localhost:' + port, 'localhost:' + port]})

    server.on('peer', function (name, peer) {
      t.same(name, 'hello-world')
      t.same(peer.port, 8080)
    })

    client2.on('peer', function (name, peer) {
      t.same(name, 'hello-world')
      t.same(peer.port, 8080)
      server.destroy()
      client1.destroy()
      client2.destroy()
    })

    server.listen(port, function () {
      client1.announce('hello-world', 8080, function () {
        client2.lookup('hello-world')
      })
    })
  })

  tape('limit', function (t) {
    var server = discovery({multicast: false, limit: 1})

    server.announce('hello-world', 8080)
    server.announce('hello-world-2', 8081)

    var domains = server.toJSON()
    t.same(domains.length, 1)
    t.same(domains[0].records.length, 1)
    t.end()
  })

  tape('push', function (t) {
    var server = discovery({multicast: false})
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
