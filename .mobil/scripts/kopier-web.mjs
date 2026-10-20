// Kopierer hjemmesiden (guiden + fællesskabet) ind i appen (mappen www)
// og retter de få ting, der skal være anderledes i en app:
//  - ingen service worker og ingen "Installér som app"-knap
//  - links til mapper peger på index.html (appens egen server kender ikke mapper)
//  - tælleren og privatlivspolitikken hentes fra hjemmesiden
//  - tilbage-knap og "Download mine data" via appen (scripts/bro.js)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBIL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROD = resolve(MOBIL, '..');                 // roden af repoet = hjemmesiden
const WWW = join(MOBIL, 'www');
const PKG = JSON.parse(readFileSync(join(MOBIL, 'package.json'), 'utf8'));
const SITE = String(PKG.gettogether.site || '').replace(/\/+$/, '');

// Kun det appen skal bruge (panelet, databasen, Netlify- og Claude-filer kommer ikke med)
const FILER = [
  'index.html', 'manifest.webmanifest', 'song.mp3', 'lang',
  'icon-192.png', 'icon-512.png', 'icon-maskable.png', 'apple-touch-icon.png',
  'faellesskab/index.html', 'faellesskab/app.js', 'faellesskab/app.css', 'faellesskab/config.js',
];

rmSync(WWW, { recursive: true, force: true });
mkdirSync(join(WWW, 'faellesskab'), { recursive: true });
for (const f of FILER) {
  const fra = join(ROD, f);
  if (!existsSync(fra)) throw new Error(`Mangler ${f} i ${ROD}`);
  cpSync(fra, join(WWW, f), { recursive: true });
}

function ret(fil, aendringer) {
  const sti = join(WWW, fil);
  let s = readFileSync(sti, 'utf8');
  for (const [fra, til, antal] of aendringer) {
    const n = s.split(fra).length - 1;
    if (n !== antal) throw new Error(`${fil}: forventede ${antal} × «${fra.slice(0, 60)}», fandt ${n}. Koden er ændret – ret scripts/kopier-web.mjs.`);
    s = s.split(fra).join(til);
  }
  writeFileSync(sti, s);
}

ret('index.html', [
  ['data-href="faellesskab/"', 'data-href="faellesskab/index.html"', 2],
  ['fetch("/api/count"', `fetch("${SITE}/api/count"`, 2],
  ['navigator.serviceWorker.register("sw.js").catch(()=>{})', '0', 1],
  ['const standalone=matchMedia("(display-mode: standalone)").matches||navigator.standalone;', 'const standalone=true;', 1],
]);
ret('faellesskab/app.js', [
  ["navigator.serviceWorker.register('sw.js').catch(() => {});", '/* ingen service worker i appen */', 1],
]);

const BRO = `<script>\n${readFileSync(join(MOBIL, 'scripts/bro.js'), 'utf8')}</script>\n</body>`;
ret('index.html', [['</body>', BRO, 1]]);
ret('faellesskab/index.html', [['</body>', BRO, 1]]);

const cfg = join(WWW, 'faellesskab/config.js');
const cfgTekst = readFileSync(cfg, 'utf8');
writeFileSync(cfg, cfgTekst + `
// --- tilføjet af appen ---
window.APP_CONFIG.GUIDE_URL = '../index.html';
window.APP_CONFIG.PRIVACY_URL = '${SITE}/faellesskab/privatliv.html';
`);

// Advarsler, så appen ikke bliver sendt ud halvfærdig
const advarsler = [];
if (/DIT-PROJEKT|DIN-ANON/.test(cfgTekst)) advarsler.push('faellesskab/config.js: SUPABASE_URL og SUPABASE_ANON_KEY er ikke udfyldt.');
if (/DIT-DOM/i.test(cfgTekst)) advarsler.push('faellesskab/config.js: LOGIN_DOMAIN er ikke udfyldt.');
if (!/^https:\/\//.test(SITE)) advarsler.push('package.json: "gettogether.site" skal være adressen på din hjemmeside (https://...).');
console.log(`✓ Hjemmesiden er kopieret ind i appen (${WWW})`);
for (const a of advarsler) console.log('⚠ ' + a);
