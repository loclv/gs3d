const path=require('path'),fs=require('fs'),http=require('http');const{chromium}=require('playwright');
const root=path.resolve(__dirname,'..','..'); // caustic-volume's parent = g3d
(async()=>{const b=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage({viewport:{width:960,height:540}});
p.on('console',m=>console.log('[con]',m.type(),m.text()));
p.on('pageerror',e=>console.log('[pageerror]',e.stack||e));
const mime={'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.jpg':'image/jpeg'};
const server=http.createServer((req,res)=>{const rel=decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/,'');const t=path.join(root,rel);if(!t.startsWith(root)||!fs.existsSync(t)||fs.statSync(t).isDirectory()){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':mime[path.extname(t)]||'application/octet-stream'});fs.createReadStream(t).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
await p.goto(`http://127.0.0.1:${server.address().port}/caustic-volume/lite/index.html`);
await p.waitForFunction(()=>window.lite&&window.lite.R,null,{timeout:120000}).catch(e=>console.log('waitfail'));
await p.waitForTimeout(2000);
console.log('R=',await p.evaluate(()=>window.lite&&window.lite.R&&window.lite.R.name));
await b.close();server.close();})();
