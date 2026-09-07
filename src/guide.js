// In-app field guide — renders docs/BIOT-GUIDE.md as a styled overlay (G key).
// Uses fetch in web/Capacitor mode, fs in Electron mode.
'use strict';

const isElectron = typeof window !== 'undefined' && typeof window.process !== 'undefined' && window.process.type === 'renderer';

const GUIDE_PATH = 'docs/BIOT-GUIDE.md';

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
}

// Load guide markdown — async in web mode, sync in Electron
function loadGuide() {
  if (isElectron) {
    try {
      const fs = require('fs');
      const path = require('path');
      const p = path.join(__dirname, '..', 'docs', 'BIOT-GUIDE.md');
      try { return Promise.resolve(fs.readFileSync(p, 'utf8')); }
      catch (e) { console.error('Guide load failed (Electron):', e); return Promise.resolve('Could not load guide.'); }
    } catch (e) {
      // fs not available — fallback to fetch
      return fetch(GUIDE_PATH).then(r => r.ok ? r.text() : Promise.reject('HTTP ' + r.status)).then(null, () => 'Could not load guide.');
    }
  } else {
    return fetch(GUIDE_PATH)
      .then(r => r.ok ? r.text() : Promise.reject('HTTP ' + r.status))
      .catch(e => { console.error('Guide load failed (web):', e); return 'Could not load guide.'; });
  }
}

// minimal markdown -> html for the subset BIOT-GUIDE.md uses
function mdToHtml(md) {
  const out = [];
  let inCode = false, inTable = false, tableRow = 0, inList = false, listType = '';
  const closeList = () => { if (inList) { out.push(listType === 'ol' ? '</ol>' : '</ul>'); inList = false; } };
  const closeTable = () => { if (inTable) { out.push('</table>'); inTable = false; } };
  const flush = () => { closeList(); closeTable(); };

  for (const raw of md.split('\n')) {
    const t = raw.trim();
    if (t.startsWith('```')) {
      flush();
      out.push(inCode ? '</pre>' : '<pre>');
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(escapeHtml(raw)); continue; }

    // indented continuation of the current list item (e.g. wrapped text)
    if (inList && t !== '' && /^\s/.test(raw)) {
      out[out.length - 1] = out[out.length - 1].replace('</li>', ' ' + inline(t) + '</li>');
      continue;
    }

    if (t.startsWith('|') && t.endsWith('|')) {
      closeList();
      if (/^\|[\s:|-]+\|$/.test(t)) continue; // separator row
      if (!inTable) { out.push('<table>'); inTable = true; tableRow = 0; }
      const cells = t.slice(1, -1).split('|').map(c => inline(c.trim()));
      const tag = tableRow === 0 ? 'th' : 'td';
      out.push('<tr>' + cells.map(c => '<' + tag + '>' + c + '</' + tag + '>').join('') + '</tr>');
      tableRow++;
      continue;
    }
    closeTable();

    if (t.startsWith('# ')) { flush(); out.push('<h1>' + inline(t.slice(2)) + '</h1>'); continue; }
    if (t.startsWith('## ')) { flush(); out.push('<h2>' + inline(t.slice(3)) + '</h2>'); continue; }

    const bullet = t.match(/^[-*] (.*)/);
    if (bullet) {
      if (!inList || listType !== 'ul') { flush(); out.push('<ul>'); inList = true; listType = 'ul'; }
      out.push('<li>' + inline(bullet[1]) + '</li>');
      continue;
    }
    const num = t.match(/^\d+\. (.*)/);
    if (num) {
      if (!inList || listType !== 'ol') { flush(); out.push('<ol>'); inList = true; listType = 'ol'; }
      out.push('<li>' + inline(num[1]) + '</li>');
      continue;
    }

    flush();
    if (t === '') continue;
    out.push('<p>' + inline(t) + '</p>');
  }
  flush();
  return out.join('\n');
}

class Guide {
  constructor() {
    this.visible = false;
    const el = document.createElement('div');
    el.id = 'biot-guide';
    el.innerHTML = `
      <style>
        #biot-guide { position:fixed; top:5vh; left:50%; transform:translateX(-50%);
                      width:min(720px,90vw); max-height:88vh; overflow:auto; z-index:200;
                      background:#000; color:#cfc; border:2px solid #0f0;
                      font:14px "Courier New", monospace; display:none;
                      box-shadow:0 0 24px rgba(0,255,0,0.25); }
        #biot-guide .guide-title { position:sticky; top:0; background:#010; color:#ff0;
                      padding:6px 10px; border-bottom:1px solid #040; font-weight:bold; }
        #biot-guide .guide-close { float:right; cursor:pointer; color:#f88; }
        #biot-guide .guide-body { padding:8px 16px 20px; line-height:1.45; }
        #biot-guide h1 { color:#ff0; font-size:17px; border-bottom:1px solid #040; }
        #biot-guide h2 { color:#0f0; font-size:15px; margin-top:18px; }
        #biot-guide b { color:#fff; }
        #biot-guide table { border-collapse:collapse; margin:8px 0; width:100%; }
        #biot-guide th, #biot-guide td { border:1px solid #050; padding:4px 8px; text-align:left; vertical-align:top; }
        #biot-guide th { color:#ff0; background:#020; }
        #biot-guide td:first-child { white-space:nowrap; }
        #biot-guide pre { background:#020; border:1px solid #040; padding:8px; overflow-x:auto; }
        #biot-guide ul, #biot-guide ol { padding-left:22px; }
        #biot-guide li { margin:3px 0; }
      </style>
      <div class="guide-title">BIOT FIELD GUIDE <span class="guide-close" id="guide-close">[X]</span></div>
      <div class="guide-body" id="guide-body">Loading guide...</div>
    `;
    document.body.appendChild(el);
    this.el = el;
    this.loaded = false;
    loadGuide().then(md => {
      el.querySelector('#guide-body').innerHTML = mdToHtml(md);
      this.loaded = true;
    });
    el.querySelector('#guide-close').onclick = () => this.hide();
  }

  show() { this.visible = true; this.el.style.display = 'block'; }
  hide() { this.visible = false; this.el.style.display = 'none'; }
  toggle() { this.visible ? this.hide() : this.show(); }
}

module.exports = { Guide, mdToHtml, loadGuide };
