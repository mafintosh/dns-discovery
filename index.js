var fifo = require('fifo')
var util = require('util')
var mdns = require('multicast-dns')
var txt = require('mdns-txt')()
var net = require('net')
var addr = require('network-address')
var events = require('events')
var crypto = require('crypto')

module.exports = function (opts) {
  if (!opts) opts = {}

  var discover = new events.EventEmitter()
  var peerId = opts.peer || crypto.randomBytes(32).toString('hex')
  var tracker = opts.tracker && parse(opts.tracker)
  var suffix = '.dns-discovery.local'
  var host = opts.host
  var port = 0
  var ttl = opts.ttl || 0
  var external = tracker && mdns({multicast: false, port: 0})
  var internal = opts.multicast !== false && mdns()
  var server = null
  var domains = new Store(opts)

  if (Buffer.isBuffer(peerId)) peerId = peerId.toString('hex')
  if (external) ondnssocket(external, true)
  if (internal) ondnssocket(internal, false)

  discover.lookup = function (id, cb) {
    if (Buffer.isBuffer(id)) id = id.toString('hex')

    var record = {
      questions: [{
        type: 'TXT',
        name: id + suffix
      }]
    }

    if (external) external.query(record, tracker)
    if (internal) internal.query(record, cb)
    else if (cb) process.nextTick(cb)
  }

  discover.announce = function (id, peer, cb) {
    if (typeof peer === 'number') peer = {port: peer}
    if (Buffer.isBuffer(id)) id = id.toString('hex')

    if (!peer.id) peer.id = peerId
    if (!peer.host) peer.host = host

    var addr = peer.id + '@' + (peer.host ? peer.host : '') + (peer.port ? ':' + peer.port : '')
    var record = {
      answers: [{
        type: 'TXT',
        name: id + suffix,
        ttl: ttl,
        data: txt.encode({peer: addr})
      }]
    }

    add(id, peer)

    if (external) external.respond(record, tracker, cb)
    else if (cb) process.nextTick(cb)
  }

  discover.unannounce = function (id, peer) {
    if (typeof peer === 'number') peer = {port: peer}
    if (!peer) peer = {id: peerId}
    var store = domains.get(id)
    if (!store) return
    var rec = store.owners[peer.id || peerId]
    if (!rec) return
    if (peer.port && peer.port !== rec.port) return
    if (peer.host && peer.host !== rec.host) return
    store.remove(rec)
  }

  discover.listen = function (port, cb) {
    if (server) throw new Error('Already listening')
    discover.on('peer', add)
    server = mdns({multicast: false, port: port})
    ondnssocket(server, true)
    if (cb) server.on('ready', cb)
  }

  discover.destroy = function (cb) {
    if (internal) internal.destroy(oninternaldestroy)
    else oninternaldestroy()

    function oninternaldestroy () {
      if (external) external.destroy(onexternaldestroy)
      else onexternaldestroy()
    }

    function onexternaldestroy () {
      if (server) server.destroy(cb)
      else if (cb) process.nextTick(cb)
    }
  }

  discover.toJSON = function () {
    return domains.toJSON()
  }

  return discover

  function add (name, peer) {
    domains.add(name + suffix).add(peer)
  }

  function ondnssocket (socket, external) {
    socket.on('query', function (query, rinfo) {
      for (var i = 0; i < query.questions.length; i++) {
        var q = query.questions[i]
        if (q.name.slice(-suffix.length) !== suffix) continue

        var store = domains.get(q.name)
        if (!store) continue

        var answers = []
        var peer = null

        while (answers.length < 10) {
          peer = store.random(peer)
          if (!peer) break

          switch (q.type) {
            case 'TXT':
              answers.push({
                type: 'TXT',
                name: q.name,
                ttl: ttl,
                data: txt.encode({peer: peer.addr})
              })
              break

            case 'A':
              answers.push({
                type: 'A',
                name: q.name,
                ttl: ttl,
                data: peer.host || addr()
              })
              break
          }
        }

        if (answers.length) socket.respond(answers, external ? rinfo : null)
      }
    })

    socket.on('response', function (response, rinfo) {
      for (var i = 0; i < response.answers.length; i++) answer(response.answers[i], rinfo)
      for (var j = 0; j < response.additionals.length; j++) answer(response.additionals[j], rinfo)
    })
  }

  function answer (a, rinfo) {
    if (a.type !== 'TXT') return
    if (a.name.slice(-suffix.length) !== suffix) return
    var data = txt.decode(a.data)
    if (!data.peer) return
    var match = data.peer.toString().match(/(.+)@([^:]*)(:(\d+))?/)
    if (!match) return

    var id = match[1]
    var host = match[2] || rinfo.address
    var port = Number(match[4] || 0)

    discover.emit('peer', a.name.slice(0, -suffix.length), {
      host: host,
      port: port,
      id: id
    })
  }
}

function parse (host) {
  return {
    port: Number(host.split(':')[1] || 53),
    address: host.split(':')[0]
  }
}

function Store (opts) {
  if (!opts) opts = {}

  var self = this

  this.limit = opts.limit || 10000
  this.ttl = opts.ttl || 0
  this.used = 0

  this._domains = {}
  this._active = fifo()
  this._onremove = onremove
  this._onadd = onadd

  function onadd () {
    self.used++
    if (self.used > self.limit) {
      var oldest = self._active.first()
      if (oldest) oldest.remove(oldest.random())
    }
  }

  function onremove () {
    self.used--
    if (this.count) return
    delete self._domains[this.name]
    self._active.remove(this.node)
  }
}

Store.prototype.get = function (name) {
  var recs = this._domains[name]
  if (!recs) return null
  this._active.bump(recs.node)
  return recs
}

Store.prototype.toJSON = function () {
  var self = this
  var names = []

  Object.keys(this._domains).forEach(function (name) {
    names.push({
      domain: name,
      records: self._domains[name].records.map(map)
    })
  })

  return names

  function map (rec) {
    return {
      id: rec.id,
      port: rec.port,
      host: rec.host
    }
  }
}

Store.prototype.add = function (name) {
  var recs = this._domains[name]
  if (recs) return recs
  recs = this._domains[name] = new Records(name, {ttl: this.ttl})
  recs.node = this._active.push(recs)
  recs.on('add', this._onadd)
  recs.on('remove', this._onremove)
  return recs
}

function Records (name, opts) {
  if (!opts) opts = {}
  this.count = 0
  this.node = null
  this.name = name
  this.ttl = 1000 * (opts.ttl || 0)
  this.records = []
  this.owners = {}
  events.EventEmitter.call(this)
}

util.inherits(Records, events.EventEmitter)

Records.prototype.add = function (record) {
  var old = this.owners[record.id]

  if (old) {
    old.host = record.host
    old.port = record.port
    old.addr = record.id + '@' + (record.host || '') + (record.port ? ':' + record.port : '')
    old.time = Date.now()
    return old
  }

  var container = {
    index: this.records.length,
    id: record.id,
    host: record.host,
    port: record.port,
    addr: record.id + '@' + (record.host || '') + (record.port ? ':' + record.port : ''),
    time: Date.now()
  }

  this.emit('add', container)
  this.count++
  this.owners[record.id] = container
  this.records.push(container)

  return container
}

Records.prototype.remove = function (container) {
  var last = this.records.pop()
  if (!last) return
  this.count--
  delete this.owners[container.id]
  if (last !== container) {
    last.index = container.index
    this.records[last.index] = last
  }
  this.emit('remove', container)
}

Records.prototype.random = function (prev) {
  var offset = prev ? prev.index + 1 : 0
  while (true) {
    if (offset >= this.records.length) return null
    var index = Math.floor(Math.random() * (this.records.length - offset)) + offset
    var chosen = this.records[index]
    if (this.ttl && (Date.now() - chosen.time) > this.ttl) {
      this.remove(chosen)
      continue
    }
    this.swap(chosen, this.records[offset])
    return chosen
  }
}

Records.prototype.swap = function (a, b) {
  var tmp = a.index
  a.index = b.index
  b.index = tmp
  this.records[b.index] = b
  this.records[a.index] = a
}
