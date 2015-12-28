# dns-discovery

Discovery peers in a distributed system using regular dns and multicast dns.

```
npm install dns-discovery
```

[![build status](http://img.shields.io/travis/mafintosh/dns-discovery.svg?style=flat)](http://travis-ci.org/mafintosh/dns-discovery)

## Usage

``` js
var discovery = require('dns-discovery')

var disc = discovery()

disc.on('peer', function (name, peer) {
  console.log(name, peer)
})

// announce an app
disc.announce('test-app', 9090)

// find peers for this app
disc.lookup('test-app')
```

## API

#### `var disc = discovery([options])`

Create a new discovery instance. Options include:

``` js
{
  peer: 'a-peer-id', // put you peer id here. defaults to a random string
  tracker: 'tracker.example.com:9090', // put a centralized dns tracker here
  ttl: someSeconds, // ttl for records in seconds. defaults to Infinity.
  limit: someLimit, // max number of records stored. defaults to 10000.
  multicast: true, // use multicast-dns. defaults to true.
  domain: 'my-domain.com' // top-level domain to use for records. defaults to dns-discovery.local
}
```

#### `disc.lookup(name, [callback])`

Do a lookup for a specific app name. When new peers are discovered for this name peer events will be emitted

``` js
disc.on('peer', function (name, peer) {
  console.log(name) // app name this peer was discovered for
  console.log(peer) // {host: 'some-ip', port: somePort, id: peerId}
})
```

#### `disc.announce(name, peer, [callback])`

Announce a new peer for a specific app name. `peer` should be an object looking like this

``` js
{
  host: someHost // defaults to your local network ip
  port: somePort // you have to specify this
  id: optionalPeerId // defaults to the peer id specified in the constructor
}
```

As a shorthand option you can use `disc.announce(name, port)`

#### `disc.unannounce(name, [peer])

Stop announcing a peer for an app.

#### `disc.listen([port], [callback])`

Listen for dns records on a specific port. You *only* need to call this if you want to turn your peer into a tracker that other peers can use to store peer objects on.

``` js
var tracker = discovery()
tracker.listen(9090, function () {
  var disc = discovery({tracker: 'localhost:9090'})
  disc.announce('test-app', 8080) // will announce this record to the above tracker
})
```

You can setup a tracker to announce records on the internet as multicast-dns only works on a local network.
The port defaults to `53` which is the standard dns port.

## CLI

There is a cli tool available as well

``` sh
npm install -g dns-discovery
dns-discovery help
```

To announce a service do

``` sh
# will announce test-app over multicast-dns
dns-discovery announce test-app --port=8080
```

To look it up

``` sh
# will print services when they are found
dns-discovery lookup test-app
```

To run a tracker

``` sh
# listen for services and store them with a ttl of 30s
dns-discovery listen --port=9090 --ttl=30
```

And to announce to that tracker (and over multicast-dns)

``` sh
# replace example.com with the host of the server running the tracker
dns-discovery announce test-app --tracker=example.com:9090 --port=9090
```

And finally to lookup using that tracker (and multicast-dns)

``` sh
dns-discovery lookup test-app --tracker=example.com:9090
```

## License

MIT
