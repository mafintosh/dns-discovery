var pkg = require('./package.json')
var debug = require('debug')(pkg.name)
var fifo = require('fifo')
var util = require('util')
var mdns = require('multicast-dns')
var addr = require('network-address')
var events = require('events')

module.exports = function (opts) {
  if (!opts) opts = {}

  var discover = new events.EventEmitter()
  var tracker = opts.tracker && parse(opts.tracker)
  var suffix = '.' + (opts.domain || 'dns-discovery.local')
  var host = opts.host
  var ttl = opts.ttl || 0
  var external = tracker && mdns({multicast: false, port: 0})
  var internal = opts.multicast !== false && mdns()
  var server = null
  var domains = new Store(opts)

  if (external) ondnssocket(external, true)
  if (internal) ondnssocket(internal, false)

  discover.lookup = function (id, cb) {
    if (Buffer.isBuffer(id)) id = id.toString('hex')

    var record = {
      questions: [{
        type: 'SRV',
        name: id + suffix
      }]
    }

    debug('127.0.0.1:- lookup for %s', id)
    debug('record %j', record)

    if (external) external.query(record, tracker)
    if (internal) internal.query(record, cb)
    else if (cb) process.nextTick(cb)
  }

  discover.announce = function (id, peer, cb) {
    if (typeof peer === 'number') peer = {port: peer}
    if (Buffer.isBuffer(id)) id = id.toString('hex')

    if (!peer.host) peer.host = host || '0.0.0.0'

    var record = {
      answers: [{
        type: 'SRV',
        name: id + suffix,
        ttl: ttl,
        data: {
          target: peer.host,
          port: peer.port
        }
      }]
    }

    add(id, peer)

    debug('%s', new Date().getTime())
    debug('127.0.0.1:- announce %s at %s:%s', id, peer.host, peer.port)
    debug('record %j', record)

    if (external) external.respond(record, tracker, cb)
    else if (cb) process.nextTick(cb)
  }

  discover.unannounce = function (id, peer) {
    var port = typeof peer === 'number' ? peer : peer.port
    var host = (typeof peer === 'number' ? host : peer.host) || '0.0.0.0'
    var addr = host + ':' + port

    var store = domains.get(id)
    if (!store) return
    var rec = store.byaddr[addr]
    if (rec) store.remove(rec)

    debug('%s:%s unannounce %s', peer.host, peer.port, id)
    debug('record was %j', rec)
    debug('%s', new Date().getTime())
  }

  discover.listen = function (port, cb) {
    if (server) throw new Error('Already listening')
    discover.on('peer', add)
    server = mdns({multicast: false, port: port || 53})
    ondnssocket(server, true)
    if (cb) server.on('ready', cb)

    debug('listen port %s', port)
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
      var answers = []

      query.questions.length>0 &&
      debug('%s:%s is looking for %s, q(size=%s)',
        rinfo.address, rinfo.port, query.questions[0].name, rinfo.size)

      for (var i = 0; i < query.questions.length; i++) {
        var q = query.questions[i]
        if (q.name.slice(-suffix.length) !== suffix) continue

        var store = domains.get(q.name)
        if (!store) continue

        var peer = null

        while (answers.length < 10) {
          peer = store.random(peer)
          if (!peer) break

          switch (q.type) {
            case 'SRV':
              answers.push({
                type: 'SRV',
                name: q.name,
                ttl: ttl,
                data: {
                  target: peer.host === '0.0.0.0' ? addr() : peer.host,
                  port: peer.port
                }
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

      debug('%s:%s resolves about %s', rinfo.address, rinfo.port, a.name)
      debug('response %j', a)

      discover.emit('peer', a.name.slice(0, -suffix.length), {
        local: !external,
        host: a.data.target === '0.0.0.0' ? rinfo.address : a.data.target,
        port: a.data.port
      })
    }
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
  debug('store added %j', name)
  return recs
}

function Records (name, opts) {
  if (!opts) opts = {}
  this.count = 0
  this.node = null
  this.name = name
  this.ttl = 1000 * (opts.ttl || 0)
  this.records = []
  this.byaddr = {}
  events.EventEmitter.call(this)
}

util.inherits(Records, events.EventEmitter)

Records.prototype.add = function (record) {
  var addr = record.host + ':' + record.port
  var old = this.byaddr[addr]

  if (old) {
    old.time = Date.now()
    return old
  }

  var container = {
    index: this.records.length,
    host: record.host,
    port: record.port,
    time: Date.now()
  }

  this.count++
  this.byaddr[addr] = container
  this.records.push(container)
  this.emit('add', container)

  return container
}

Records.prototype.remove = function (container) {
  var last = this.records.pop()
  if (!last) return
  this.count--
  delete this.byaddr[container.host + ':' + container.port]
  if (last !== container) {
    last.index = container.index
    this.records[last.index] = last
  }
  this.emit('remove', container)
  debug('store removed %j', container)
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
