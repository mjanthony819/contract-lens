import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const OUT=process.env.SHOTS||'/downloads/cl';
const server=createServer(async(req,res)=>{try{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';const data=await readFile(new URL('.'+p,import.meta.url));res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');res.end(data)}catch{res.statusCode=404;res.end('Not found')}}).listen(8766,'127.0.0.1');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME||undefined});
const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});const page=await ctx.newPage();const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('request',r=>requests.push(r.url()));
const gate=()=>page.locator('#gate').innerText();
try{await page.goto('http://127.0.0.1:8766');await page.locator('.finding').first().waitFor();
assert.match(await gate(),/OPEN/);assert.match(await gate(),/0 of 4/);
const sels=page.locator('.finding:not(.review) .decision select'),notes=page.locator('.finding:not(.review) .decision input');assert.equal(await sels.count(),4);
await sels.nth(0).selectOption('will-migrate');assert.match(await gate(),/0 of 4/,'status without a note must not count');
await notes.nth(0).fill('Ticket API-12');assert.match(await gate(),/1 of 4/);
await page.screenshot({path:OUT+'/review-open.png',fullPage:true});
for(let i=1;i<4;i++){await sels.nth(i).selectOption(i===3?'accepted-risk':'will-migrate');await notes.nth(i).fill('<img src=x onerror=alert(1)> note '+i)}
assert.match(await gate(),/PASS/);assert.match(await gate(),/4 of 4/);
// policy
await page.locator('#policy').selectOption('review');const n=await page.locator('.finding.review').count();assert.equal(/PASS/.test(await gate()),n===0);await page.locator('#policy').selectOption('breaking');assert.match(await gate(),/PASS/);
// save session
let dl=page.waitForEvent('download');await page.locator('#save-session').click();let d=await dl;await d.saveAs(OUT+'/session.json');const sess=JSON.parse(await readFile(OUT+'/session.json','utf8'));assert.equal(sess.format,'contract-lens-review');assert.equal(Object.keys(sess.decisions).length,4);assert.equal(sess.baseline,'v1.4.0');assert.ok(!JSON.stringify(sess).includes('openapi'),'session must not contain specs');
// md export contains decisions, escaped as plain text
dl=page.waitForEvent('download');await page.getByRole('button',{name:/Migration report/}).click();d=await dl;await d.saveAs(OUT+'/report.md');const md=await readFile(OUT+'/report.md','utf8');assert.match(md,/Gate: \*\*PASS \(all blocking items acknowledged, not fixed\)/);assert.match(md,/Ticket API-12/);
assert.equal(await page.evaluate(()=>!!window.__xss),false);
// reload: decisions are gone (nothing persisted), then load session restores them
await page.reload();await page.locator('.finding').first().waitFor();assert.match(await gate(),/0 of 4/);
await page.locator('#session-file').setInputFiles(OUT+'/session.json');await page.waitForFunction(()=>/PASS/.test(document.getElementById('gate').innerText));
assert.equal(await page.locator('.finding:not(.review) .decision input').first().inputValue(),'Ticket API-12');
// stale: switch candidate to additive release, decisions no longer match
await page.locator('#scenario').selectOption('safe');assert.match(await gate(),/4 saved decision\(s\) did not match/);
// bad session file
await writeFile(OUT+'/bad.json','{"format":"x"}');await page.locator('#session-file').setInputFiles(OUT+'/bad.json');assert.match(await page.locator('#error').innerText(),/Not a Contract Lens review session/);
// storage: nothing persisted
assert.equal(await page.evaluate(()=>localStorage.length+document.cookie.length),0);
// mobile
await page.locator('#scenario').selectOption('breaking');await page.locator('#session-file').setInputFiles(OUT+'/session.json');
for(const w of[390,320]){await page.setViewportSize({width:w,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overflow at '+w);await page.screenshot({path:OUT+'/review-mobile-'+w+'.png',fullPage:true})}
await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:OUT+'/review-pass.png',fullPage:true});
assert.deepEqual(errors,[]);assert.ok(requests.every(u=>u.startsWith('http://127.0.0.1:8766/')||u.startsWith('blob:')||u.startsWith('data:')),requests.join());
console.log('Review UI checks passed.');
}finally{await browser.close();server.close()}
