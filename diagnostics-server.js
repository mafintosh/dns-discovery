var os = require('os')
var http = require('http')
var fs = require('fs')
var speedometer = require('speedometer')

// capture the last 10 minutes of stats
const HISTORY_LIMIT = 60
const HISTORY_INTERVAL = 10e3

var queriesSpeed = speedometer()
var multicastQueriesSpeed = speedometer()
var queriesPS = []
var multicastQueriesPS = []

exports.createServer = function (disc, opts = {}) {
  // logging
  var log = ''
  function track(evt) {
    disc.on(evt, (...args) => {
      log += renderLogEntry(evt, (new Date()).toLocaleString(), args)
    })
  }
  track('traffic')
  track('secrets-rotated')
  track('error')
  track('listening')
  track('close')
  track('peer')

  // stats
  disc.on('traffic', (type) => {
    if (type === 'in:query') {
      queriesSpeed(1)
    }
    if (type === 'in:multicastquery') {
      multicastQueriesSpeed(1)
    }
  })
  setInterval(() => {
    queriesPS.unshift(queriesSpeed())
    if (queriesPS.length > HISTORY_LIMIT) queriesPS.pop()
    multicastQueriesPS.unshift(multicastQueriesSpeed())
    if (multicastQueriesPS.length > HISTORY_LIMIT) multicastQueriesPS.pop()
  }, HISTORY_INTERVAL)

  // server
  return http.createServer((req, res) => {
    // auth
    if (opts.password) {
      var auth = req.headers.authorization
      if (!auth) {
        res.writeHead(401, {'WWW-Authenticate': 'Basic realm="Password needed"', 'Content-Type': 'text/plain'})
        return res.end('need password')
      }
      var givenPW = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':')[1]
      if (givenPW !== opts.password) {
        res.writeHead(401, {'WWW-Authenticate': 'Basic realm="Password needed"', 'Content-Type': 'text/plain'})
        return res.end('bad password')
      }
    }

    // serve
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, {'Content-Type': 'text/html'})
      fs.createReadStream('./diagnostics-server/index.html').pipe(res)
    } else if (req.url === '/index.css') {
      res.writeHead(200, {'Content-Type': 'text/css'})
      fs.createReadStream('./diagnostics-server/index.css').pipe(res)
    } else if (req.url === '/index.js') {
      res.writeHead(200, {'Content-Type': 'application/javascript'})
      fs.createReadStream('./diagnostics-server/index.js').pipe(res)
    } else if (req.url === '/state.json') {
      res.writeHead(200, {'Content-Type': 'application/json'})
      res.end(JSON.stringify({
        stats: {
          queriesPS,
          multicastQueriesPS,
          loadavg: os.loadavg(),
          topKeys: disc._domainStore.getTopKeyStats()
        },
        peers: disc.toJSON()
      }))
    } else if (req.url === '/log.txt') {
      res.writeHead(200, {'Content-Type': 'text/plain'})
      res.end(log)
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
    }
  })
}

function renderLogEntry (evt, ts, args) {
  switch (evt) {
    case 'listening':
      return `${ts} Listening\n`
    case 'traffic':
      let info = args[1]
      switch (args[0]) {
        case 'in:query':
          return `${ts} <- query              (from: ${info.peer.host}:${info.peer.port})    ${renderDNSMsg(info.message)}\n`
        case 'in:multicastquery':
          return `${ts} <- multicast query    (from: ${info.peer.address}:${info.peer.port})   ${renderDNSMsg(info.message)}\n`
        case 'in:multicastresponse':
          return `${ts} <- multicast response (from: ${info.peer.address}:${info.peer.port})   ${renderDNSMsg(info.message)}\n`
        case 'out:response':
          return `${ts} -> response           (to: ${info.peer.host}:${info.peer.port})      ${renderDNSMsg(info.message)}\n`
        case 'out:multicastresponse':
          return `${ts} -> multicast response                            ${renderDNSMsg(info.message)}\n`
        case 'out:query':
          return `${ts} -> query              (to: ${info.peer.host}:${info.peer.port})      ${renderDNSMsg(info.message)}\n`
        case 'out:multicastquery':
          return `${ts} -> multicast query                               ${renderDNSMsg(info.message)}\n`
        default:
          return `${ts} TODO ${JSON.stringify(args)}\n`
      }
    case 'peer':
      return `${ts} Peer for "${args[0]}" at ${args[1].host}:${args[1].port}\n`
    case 'close':
      return `${ts} Closed\n`
    case 'secrets-rotated':
      return `${ts} Secrets rotated\n`
    default:
      return `${ts} Unknown event: ${JSON.stringify({evt, args})}\n`
  }
}

function renderDNSMsg ({id, questions, answers, additionals}) {
  function item (prefix) {
    return ({type, name}) => {
      return `${safen(prefix)}.${safen(type)}:${safen(name)}`
    }
  }
  return ((id) ? `id=${safen(id)} ` : '') + `${questions.map(item('Q')).join(' ')} ${answers.map(item('A')).join(' ')} ${questions.map(item('ADD')).join(' ')}`
}

function safen (str) {
  return (''+str).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&/g, '&amp;').replace(/"/g, '')
}