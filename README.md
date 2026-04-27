# Web interface for gene set searching

## Development instructions

First, we obtain the **gesel** source code:

```bash
git clone --depth=1 https://github.com/gesel-inc/gesel.js gesel
```

The browser Cache API requires HTTPS, so we need to set up some certificates:

```bash
mkcert -install
mkcert localhost
```

Then we can serve the content of this directory via HTTPS.
This is most easily done with a `server.js` script:

```js
const https = require('https');
const fs = require('fs');

const options = {
  key: fs.readFileSync('localhost-key.pem'),
  cert: fs.readFileSync('localhost.pem')
};

https.createServer(options, function (req, res) {
    if (req.url.endsWith(".js")) {
        res.writeHead(200, { "Content-Type": "text/javascript" });
    }
    console.log(req.url);
    fs.readFile('./' + req.url, function (error, data) {
        res.end(data);
    });
}).listen(8080);

console.log("The server is listening to port 8080 with HTTPS enabled.");
```

And then running the following code will allow testing of the website on https://0.0.0.0:8080/index.html.

```bash
node server.js
```


