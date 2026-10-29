const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve('public');
http.createServer((req,res) => {
  const url = new URL(req.url,'http://localhost');
  const target = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!target.startsWith(root + path.sep)) {res.writeHead(403);res.end();return;}
  fs.readFile(target,(err,data) => {
    if(err){res.writeHead(404);res.end('Not found');return;}
    res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.png':'image/png','.woff2':'font/woff2'})[path.extname(target)] || 'application/octet-stream');
    res.end(data);
  });
}).listen(4173,'127.0.0.1',()=>console.log('Health ID preview: http://localhost:4173'));
