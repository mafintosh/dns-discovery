var mdns = require('multicast-dns')
var events = require('events')
var address = require('network-address')
var debug = require('debug')('dns-discovery')
var store = require('./store')

module.exports = function (opts) {
  if (!opts) opts = {}

  var discover = new events.EventEmitter()
  var discoveryServers = opts.server && parse(opts.server)
  var suffix = '.' + (opts.domain || 'dns-discovery.local')
  var host = opts.host
  var ttl = opts.ttl || 0
  var external = discoveryServers && mdns({multicast: false, port: 0, socket: opts.socket})
  var internal = opts.multicast !== false && mdns()
  var dnsServer = null

  var domains = store(opts)
  var pushOpts = opts.push === true ? {} : opts.push
  if (pushOpts && !pushOpts.ttl) pushOpts.ttl = opts.ttl || 60
  var push = pushOpts && store(pushOpts)

  if (external) ondnssocket(external, true, false)
  if (internal) ondnssocket(internal, false, false)

  discover.lookup = function (id, cb) {
    if (Buffer.isBuffer(id)) id = id.toString('hex')

    var error = null
    var missing = 0

    var record = {
      questions: [{
        type: 'SRV',
        name: id + suffix
      }]
    }

    debug('looking up %s', id)

    if (external) {
      for (var i = 0; i < discoveryServers.length; i++) {
        missing++
        external.query(record, discoveryServers[i], done)
      }
    }

    if (internal) {
      missing++
      internal.query(record, done)
    }

    missing++
    process.nextTick(done)

    function done (err) {
      if (err) error = err
      if (!--missing && cb) cb(error)
    }
  }

  discover.announce = function (id, peer, cb) {
    if (typeof peer === 'number') peer = {port: peer}
    if (Buffer.isBuffer(id)) id = id.toString('hex')

    if (!peer.host) peer.host = host || '0.0.0.0'

    var error = null
    var missing = 0

    var record = {
      answers: [{
        type: 'SRV',
        name: id + suffix,
        ttl: ttl,
        data: {
          target: peer.host,
          port: peer.port || 0
        }
      }]
    }

    if (!peer.port && opts.socket) peer.port = opts.socket.address().port

    debug('announcing %s:%d for %s', peer.host, peer.port, id)
    add(id, peer)

    if (external) {
      for (var i = 0; i < discoveryServers.length; i++) {
        missing++
        external.respond(record, discoveryServers[i], done)
      }
    }

    missing++
    process.nextTick(done)

    function done (err) {
      if (err) error = err
      if (!--missing && cb) cb(error)
    }
  }

  discover.unannounce = function (id, peer) {
    var port = typeof peer === 'number' ? peer : peer.port
    var host = (typeof peer === 'number' ? host : peer.host) || '0.0.0.0'

    domains.remove(id + suffix, port, host)
  }

  discover.listen = function (port, cb) {
    if (dnsServer) throw new Error('Already listening')
    discover.on('peer', add)
    dnsServer = mdns({multicast: false, port: port || 53})
    ondnssocket(dnsServer, true, true)
    if (cb) dnsServer.on('ready', cb)
  }

  discover.destroy = function (cb) {
    if (internal) internal.destroy(oninternaldestroy)
    else oninternaldestroy()

    function oninternaldestroy () {
      if (external) external.destroy(onexternaldestroy)
      else onexternaldestroy()
    }

    function onexternaldestroy () {
      if (dnsServer) dnsServer.destroy(cb)
      else if (cb) process.nextTick(cb)
    }
  }

  discover.toJSON = function () {
    return domains.toJSON()
  }

  return discover

  function add (name, peer) {
    domains.add(name + suffix, peer.port, peer.host)
    debug('adding %s:%d for %s', peer.host, peer.port, name)
    if (!push || !dnsServer) return

    var pushes = push.get(name + suffix, 10)
    var record = {
      answers: [{
        type: 'SRV',
        name: name + suffix,
        ttl: ttl,
        data: {
          target: peer.host,
          port: peer.port
        }
      }]
    }

    for (var i = 0; i < pushes.length; i++) {
      dnsServer.respond(record, {port: pushes[i].port, address: pushes[i].host})
    }
  }

  function ondnssocket (socket, external, server) {
    socket.on('query', function (query, rinfo) {
      var answers = []

      for (var i = 0; i < query.questions.length; i++) {
        var q = query.questions[i]
        debug('received dns query for %s', q.name)
        if (q.name.slice(-suffix.length) !== suffix) continue
        if (server && push) push.add(q.name, rinfo.port, rinfo.address)

        var peers = domains.get(q.name, 10)

        for (var j = 0; j < peers.length; j++) {
          var port = peers[j].port
          var host = peers[j].host

          switch (q.type) {
            case 'SRV':
              answers.push({
                type: 'SRV',
                name: q.name,
                ttl: ttl,
                data: {
                  target: host,
                  port: port
                }
              })
              break

            case 'A': // mostly for debugging
              answers.push({
                type: 'A',
                name: q.name,
                ttl: ttl || 30,
                data: host === '0.0.0.0' ? address() : host
              })
              break
          }
        }
      }

      if (query.id || answers.length) socket.respond({id: query.id, answers: answers}, external ? rinfo : null)
    })

    socket.on('response', function (response, rinfo) {
      for (var i = 0; i < response.answers.length; i++) answer(response.answers[i], rinfo)
      for (var j = 0; j < response.additionals.length; j++) answer(response.additionals[j], rinfo)
    })

    function answer (a, rinfo) {
      if (a.type !== 'SRV') return
      if (a.name.slice(-suffix.length) !== suffix) return

      discover.emit('peer', a.name.slice(0, -suffix.length), {
        local: !external,
        host: a.data.target === '0.0.0.0' ? rinfo.address : a.data.target,
        port: a.data.port || rinfo.port
      })
    }
  }
}

function parse (hosts) {
  if (!Array.isArray(hosts)) hosts = [hosts]

  return hosts.map(function (host) {
    return {
      port: Number(host.split(':')[1] || 53),
      address: host.split(':')[0]
    }
  })
}
