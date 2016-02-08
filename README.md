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
  server: 'discovery.example.com:9090', // put a centralized dns discovery server here
  ttl: someSeconds, // ttl for records in seconds. defaults to Infinity.
  limit: someLimit, // max number of records stored. defaults to 10000.
  multicast: true, // use multicast-dns. defaults to true.
  domain: 'my-domain.com' // top-level domain to use for records. defaults to dns-discovery.local
}
```

If you have more than one discovery server you can specify an array

``` js
{
  server: [
    'discovery.example.com:9090',
    'another.discovery.example.com'
  ]
}
```

#### `disc.lookup(name, [callback])`

Do a lookup for a specific app name. When new peers are discovered for this name peer events will be emitted

``` js
disc.on('peer', function (name, peer) {
  console.log(name) // app name this peer was discovered for
  console.log(peer) // {host: 'some-ip', port: somePort}
})
```

#### `disc.announce(name, peer, [callback])`

Announce a new peer for a specific app name. `peer` should be an object looking like this

``` js
{
  host: someHost // defaults to your local network ip
  port: somePort // you have to specify this
}
```

As a shorthand option you can use `disc.announce(name, port)`

#### `disc.unannounce(name, peer)`

Stop announcing a peer for an app.

#### `disc.listen([port], [callback])`

Listen for dns records on a specific port. You *only* need to call this if you want to turn your peer into a discovery server that other peers can use to store peer objects on.

``` js
var server = discovery()
server.listen(9090, function () {
  var disc = discovery({server: 'localhost:9090'})
  disc.announce('test-app', 8080) // will announce this record to the above discovery server
})
```

You can setup a discovery server to announce records on the internet as multicast-dns only works on a local network.
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

To run a discovery server

``` sh
# listen for services and store them with a ttl of 30s
dns-discovery listen --port=9090 --ttl=30
```

And to announce to that discovery server (and over multicast-dns)

``` sh
# replace example.com with the host of the server running the discovery server
dns-discovery announce test-app --server=example.com:9090 --port=9090
```

And finally to lookup using that discovery server (and multicast-dns)

``` sh
dns-discovery lookup test-app --server=example.com:9090
```

You can use any other dns client to resolve the records as well. For example using `dig`.

``` sh
# dig requires the discovery server to run on port 53
dig @discovery.example.com test-app SRV
```

## License

MIT
