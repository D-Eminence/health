const esbuild = require("esbuild");
esbuild.buildSync({
  entryPoints: ["src/app.tsx"],
  bundle: true,
  outfile: "public/app.js",
  sourcemap: true,
  target: "es2022",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', __HEALTH_ID_DEMO__: process.env.HEALTH_ID_DEMO === "false" ? "false" : "true" },
});
console.log("Built Health ID Hospital EHR TypeScript application.");
const fs = require("fs"),
  crypto = require("crypto");
// Immutable URLs keep newly loaded HTML and styles in the same release even
// while an older offline worker is waiting for its existing tabs to close.
const files = ["app.js", "base.css", "brand.css", "redesign.css", "application.css", "feedback.css"];
let html = fs.readFileSync("public/index.html", "utf8");
const releaseAssets = files.map(file => {
  const bytes = fs.readFileSync("public/" + file);
  const hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const dot = file.lastIndexOf(".");
  const stem = file.slice(0, dot), extension = file.slice(dot + 1);
  const versioned = `${stem}.${hash}.${extension}`;
  fs.writeFileSync("public/" + versioned, bytes);
  html = html.replace(new RegExp(`(["'])${stem}(?:\\.[a-f0-9]+)?\\.${extension}(["'])`, "g"), `$1${versioned}$2`);
  return "/" + versioned;
});
fs.writeFileSync("public/index.html", html);
const assets = [
  "/",
  "/index.html",
  "/app.js",
  "/base.css",
  "/brand.css",
  "/redesign.css",
  "/application.css",
  "/feedback.css",
  "/brand/logo.png",
  "/brand/logo-icon.png",
  ...releaseAssets,
];
const version = crypto
  .createHash("sha256")
  .update(
    assets
      .slice(1)
      .map((p) => fs.readFileSync("public" + p))
      .join(""),
  )
  .digest("hex")
  .slice(0, 16);
fs.writeFileSync(
  "public/sw.js",
  `const CACHE='health-id-${version}',ASSETS=${JSON.stringify(assets)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('message',event=>{if(event.data?.type!=='health-id-activate')return;event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const results=await Promise.all(windows.map(client=>new Promise(resolve=>{const channel=new MessageChannel();const timer=setTimeout(()=>resolve(false),2500);channel.port1.onmessage=e=>{clearTimeout(timer);resolve(e.data===true);channel.port1.close();};client.postMessage({type:'health-id-update-check'},[channel.port2]);})));const safe=results.every(Boolean);if(safe)await self.skipWaiting();event.ports[0]?.postMessage(safe);})());});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('health-id-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==location.origin||url.pathname==='/health.json')return;if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.match('/index.html')));return;}if(ASSETS.includes(url.pathname))event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(url.pathname))||fetch(event.request)));});
`,
);
