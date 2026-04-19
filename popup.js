// ═══════════════════════════════════════════════════════════════════
//  HTML Grabber Pro — popup.js
// ═══════════════════════════════════════════════════════════════════

// ── DOM refs ──────────────────────────────────────────────────────
const grabBtn       = document.getElementById('grabBtn');
const xpathBtn      = document.getElementById('xpathBtn');
const saveBtn       = document.getElementById('saveBtn');
const status        = document.getElementById('status');
const pageUrlEl     = document.getElementById('pageUrl');
const lastSizeEl    = document.getElementById('lastSize');
const selectorRow   = document.getElementById('selectorRow');
const selectorInput = document.getElementById('selectorInput');
const detectBanner  = document.getElementById('detectBanner');
const detectDesc    = document.getElementById('detectDesc');
const detectSections= document.getElementById('detectSections');
const historyEmpty  = document.getElementById('historyEmpty');
const historyList   = document.getElementById('historyList');
const historyClear  = document.getElementById('historyClear');
const diffA         = document.getElementById('diffA');
const diffB         = document.getElementById('diffB');
const diffBtn       = document.getElementById('diffBtn');
const diffResult    = document.getElementById('diffResult');
const pills         = document.querySelectorAll('.pill');

// ── State ─────────────────────────────────────────────────────────
let currentMode   = 'full';
let pickingActive = false;
let currentTab    = null;
let lastGrabbedHTML = null;
let lastGrabbedXPath = null;
let settings = { autoDetect: true, saveHistory: true, autoXpath: false, timestampFiles: true };

// ═══════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════
async function init() {
  await loadSettings();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  if (tab?.url) pageUrlEl.textContent = tab.url;

  renderHistory();
  renderDiffSelects();

  if (settings.autoDetect) runAutoDetect();

  // Check if background shortcut grabbed something
  const stored = await chrome.storage.local.get('__shortcut_html__');
  if (stored.__shortcut_html__) {
    lastGrabbedHTML = stored.__shortcut_html__;
    await chrome.storage.local.remove('__shortcut_html__');
    setStatus('Shortcut grab ready — click Save or it\'s already in clipboard', 'ok');
  }
}

// ═══════════════════════════════════════════════════════════════════
//  TAB SWITCHING
// ═══════════════════════════════════════════════════════════════════
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'history') renderHistory();
    if (tab.dataset.tab === 'diff')    renderDiffSelects();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MODE PILLS
// ═══════════════════════════════════════════════════════════════════
pills.forEach(pill => {
  pill.addEventListener('click', () => {
    pills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    currentMode = pill.dataset.mode;

    selectorRow.style.display = currentMode === 'selector' ? 'block' : 'none';

    if (currentMode === 'full') {
      grabBtn.textContent = '⚡ Copy HTML'; grabBtn.className = 'grab-btn';
      setStatus('');
    } else if (currentMode === 'pick') {
      grabBtn.textContent = '🎯 Start Picking'; grabBtn.className = 'grab-btn';
      setStatus('Click Start Picking, then click any element on the page', 'warn');
    } else if (currentMode === 'selector') {
      grabBtn.textContent = '⚡ Copy HTML'; grabBtn.className = 'grab-btn';
      setStatus('Enter a CSS selector above', 'warn');
    }

    if (currentMode !== 'pick' && pickingActive) cancelPick();
  });
});

// ═══════════════════════════════════════════════════════════════════
//  MAIN GRAB BUTTON
// ═══════════════════════════════════════════════════════════════════
grabBtn.addEventListener('click', async () => {
  if (currentMode === 'full')     return grabFull();
  if (currentMode === 'selector') return grabBySelector();
  if (currentMode === 'pick')     return startPick();
});

// ── XPATH BUTTON ─────────────────────────────────────────────────
xpathBtn.addEventListener('click', async () => {
  if (!lastGrabbedHTML && currentMode !== 'pick') {
    setStatus('Grab something first, then copy its XPath', 'warn'); return;
  }
  if (lastGrabbedXPath) {
    await navigator.clipboard.writeText(lastGrabbedXPath);
    flashBtn(xpathBtn, '✓ XPath copied!');
    setStatus('XPath copied to clipboard', 'ok');
  } else {
    setStatus('XPath only available after picking an element', 'warn');
  }
});

// ── SAVE FILE BUTTON ──────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
  if (!lastGrabbedHTML) { setStatus('Nothing grabbed yet', 'warn'); return; }
  downloadHTML(lastGrabbedHTML, currentTab?.url || 'page');
  flashBtn(saveBtn, '✓ Saved!');
});

// ═══════════════════════════════════════════════════════════════════
//  HTML SERIALIZER WITH INLINE COMPUTED STYLES
//  Outputs clean indented HTML like:
//    <div style="display:flex;padding:10.5px;background-color:rgb(...);">
//        <span style="font-weight:600;">Land:</span>
//        <span style="...">Austria</span>
//    </div>
// ═══════════════════════════════════════════════════════════════════

// Injected into the page via executeScript.
// args[0] = CSS selector string, or null for full body.
function serializeAccessibilityTree(rootSelector) {

  // Tags we never want in the output
  const SKIP_TAGS = new Set([
    'script','style','noscript','meta','link','head',
    'template','slot',
  ]);

  // Void elements — no closing tag
  const VOID_TAGS = new Set([
    'area','base','br','col','embed','hr','img','input',
    'link','meta','param','source','track','wbr',
  ]);

  // CSS properties to include in the inline style
  // Only properties that carry real visual/layout meaning
  const STYLE_PROPS = [
    'display','overflow','overflow-x','overflow-y',
    'flex-direction','flex-wrap','flex','flex-grow','flex-shrink','flex-basis',
    'justify-content','align-items','align-self','align-content','gap',
    'grid-template-columns','grid-template-rows','grid-column','grid-row',
    'position','top','right','bottom','left','z-index','float',
    'width','height','min-width','max-width','min-height','max-height',
    'padding','padding-top','padding-right','padding-bottom','padding-left',
    'margin','margin-top','margin-right','margin-bottom','margin-left',
    'border','border-top','border-right','border-bottom','border-left',
    'border-radius','border-collapse','border-color','border-width',
    'background-color','background-image','background-size','background-position',
    'background-repeat','backdrop-filter',
    'color','font-family','font-size','font-weight','font-style',
    'line-height','letter-spacing','text-align','text-decoration','text-transform',
    'white-space','word-break','overflow-wrap','vertical-align',
    'cursor','opacity','visibility','pointer-events',
    'box-sizing','box-shadow','text-shadow',
    'user-select','resize','list-style',
    'border-spacing','table-layout',
    'transform','transition-property','transition-duration','transition-timing-function',
    'aspect-ratio','object-fit','object-position',
  ];

  // Computed values that add no information — skip them
  const SKIP_VALUES = new Set([
    '','auto','normal','none','initial','unset','inherit','revert',
    'static','inline','0px','0%','0','rgba(0, 0, 0, 0)','transparent',
    'visible','start','left','top','separate','disc','outside',
    'repeat','scroll','padding-box','border-box',
    'ease','all','0s',
  ]);

  function buildStyleAttr(el) {
    const computed  = window.getComputedStyle(el);
    const original  = el.getAttribute('style') || '';

    // Collect computed values for our chosen props
    const map = new Map();
    STYLE_PROPS.forEach(prop => {
      const val = computed.getPropertyValue(prop).trim();
      if (val && !SKIP_VALUES.has(val)) map.set(prop, val);
    });

    // Overlay original inline styles (they may have values computed misses,
    // like CSS variables, shorthand with spaces, etc.)
    if (original) {
      original.split(';').forEach(decl => {
        const colon = decl.indexOf(':');
        if (colon === -1) return;
        const key = decl.slice(0, colon).trim();
        const val = decl.slice(colon + 1).trim();
        if (key && val) map.set(key, val);  // original wins
      });
    }

    if (!map.size) return '';
    return Array.from(map.entries()).map(([k, v]) => `${k}:${v}`).join(';');
  }

  function escapeAttr(str) {
    return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  }

  function escapeText(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function serialize(node, depth) {
    const indent = '    '.repeat(depth);

    // Text node
    if (node.nodeType === 3) {
      const t = node.textContent.replace(/\s+/g, ' ').trim();
      return t ? indent + escapeText(t) + '\n' : '';
    }

    if (node.nodeType !== 1) return '';

    const tag = node.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return '';

    // Build attribute string
    const attrParts = [];

    // style — computed + original merged
    const styleStr = buildStyleAttr(node);
    if (styleStr) attrParts.push(`style="${escapeAttr(styleStr)}"`);

    // All other meaningful HTML attributes
    const HTML_ATTRS = [
      'id','class','href','src','srcset','alt','placeholder',
      'rows','cols','type','value','name','for','action','method',
      'width','height','loading','decoding','data-nimg',
      'role','aria-label','aria-hidden','tabindex',
      'target','rel','data-id','data-type',
    ];
    HTML_ATTRS.forEach(a => {
      const v = node.getAttribute(a);
      if (v !== null && v.trim() !== '') attrParts.push(`${a}="${escapeAttr(v.trim())}"`);
    });

    const attrsStr = attrParts.length ? ' ' + attrParts.join(' ') : '';

    // Void elements — self-closing
    if (VOID_TAGS.has(tag)) {
      return `${indent}<${tag}${attrsStr} />\n`;
    }

    // Check if only text children (write inline for compact output)
    const childNodes = Array.from(node.childNodes);
    const textOnly = childNodes.every(
      c => c.nodeType === 3 || (c.nodeType === 1 && SKIP_TAGS.has(c.tagName.toLowerCase()))
    );
    const textContent = node.textContent.replace(/\s+/g, ' ').trim();

    if (textOnly && textContent) {
      return `${indent}<${tag}${attrsStr}>${escapeText(textContent)}</${tag}>\n`;
    }

    // Element with children — open tag, recurse, close tag
    let out = `${indent}<${tag}${attrsStr}>\n`;
    for (const child of childNodes) {
      out += serialize(child, depth + 1);
    }
    out += `${indent}</${tag}>\n`;
    return out;
  }

  const root = rootSelector
    ? document.querySelector(rootSelector)
    : document.body;

  if (!root) return null;

  // For full page, wrap in proper html/head/body structure
  if (!rootSelector) {
    return `<html>\n\n<head></head>\n\n` + serialize(root, 0) + `\n</html>`;
  }
  return serialize(root, 0);
}

// ═══════════════════════════════════════════════════════════════════
//  GRAB MODES
// ═══════════════════════════════════════════════════════════════════

async function grabFull() {
  setLoading('⏳ Serializing HTML + styles...');
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: serializeAccessibilityTree,
      args: [null],
    });
    const tree = results[0]?.result;
    if (!tree) throw new Error('No content returned.');
    await finishGrab(tree, 'Full page + inline styles', null);
  } catch (e) { showError(e.message); }
}

async function grabBySelector() {
  const sel = selectorInput.value.trim();
  if (!sel) { setStatus('Enter a CSS selector first', 'err'); return; }
  setLoading('⏳ Serializing HTML + styles...');
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: serializeAccessibilityTree,
      args: [sel],
    });
    const tree = results[0]?.result;
    if (!tree) throw new Error(`No element found for: "${sel}"`);

    // also grab xpath
    const xpathResult = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: (selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        if (el.id) return `//*[@id="${el.id}"]`;
        const parts = []; let node = el;
        while (node && node.nodeType === 1) {
          let idx = 1, sib = node.previousSibling;
          while (sib) { if (sib.nodeType === 1 && sib.tagName === node.tagName) idx++; sib = sib.previousSibling; }
          parts.unshift(`${node.tagName.toLowerCase()}[${idx}]`);
          node = node.parentNode;
        }
        return '/' + parts.join('/');
      },
      args: [sel],
    });
    await finishGrab(tree, `Selector: ${sel}`, xpathResult[0]?.result || null);
  } catch (e) { showError(e.message); }
}

async function startPick() {
  pickingActive = true;
  grabBtn.className = 'grab-btn waiting';
  grabBtn.textContent = '⏳ Waiting for pick...';
  setStatus('Switch to the page and click an element  |  ESC to cancel', 'warn');

  await chrome.scripting.executeScript({
    target: { tabId: currentTab.id },
    func: injectPicker,
  });

  pollForPickResult(currentTab.id);
}

function pollForPickResult(tabId) {
  const interval = setInterval(async () => {
    if (!pickingActive) { clearInterval(interval); return; }
    try {
      const picked = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const v = sessionStorage.getItem('__htmlgrabber_picked__');
          if (v) sessionStorage.removeItem('__htmlgrabber_picked__');
          return v ? JSON.parse(v) : null;
        },
      });
      const result = picked[0]?.result;
      if (result) {
        clearInterval(interval);
        pickingActive = false;
        await finishGrab(result.html, 'Picked element', result.xpath);
        if (settings.autoXpath && result.xpath) {
          await navigator.clipboard.writeText(result.xpath);
          setStatus(`HTML + XPath copied! XPath: ${result.xpath.slice(0, 40)}...`, 'ok');
        }
        return;
      }
      const cancelled = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => { const v = sessionStorage.getItem('__htmlgrabber_cancelled__'); if(v) sessionStorage.removeItem('__htmlgrabber_cancelled__'); return v; },
      });
      if (cancelled[0]?.result) { clearInterval(interval); cancelPick(); }
    } catch(_) { clearInterval(interval); cancelPick(); }
  }, 350);
}

function cancelPick() {
  pickingActive = false;
  grabBtn.className = 'grab-btn';
  grabBtn.textContent = '🎯 Start Picking';
  setStatus('Pick cancelled', 'warn');
}

// ═══════════════════════════════════════════════════════════════════
//  FINISH GRAB — copy, save history, update UI
// ═══════════════════════════════════════════════════════════════════
async function finishGrab(html, mode, xpath) {
  await navigator.clipboard.writeText(html);
  lastGrabbedHTML  = html;
  lastGrabbedXPath = xpath || null;

  const sizeKB = (new Blob([html]).size / 1024).toFixed(1);
  lastSizeEl.textContent = `${sizeKB} KB`;

  if (settings.saveHistory) {
    await addToHistory({ html, mode, xpath, url: currentTab?.url || '', sizeKB, ts: Date.now() });
  }

  grabBtn.className = 'grab-btn success';
  grabBtn.textContent = '✓ Copied!';
  setStatus(`${sizeKB} KB copied — mode: ${mode}`, 'ok');

  setTimeout(() => {
    grabBtn.className = 'grab-btn';
    grabBtn.textContent = currentMode === 'pick' ? '🎯 Start Picking' : '⚡ Copy HTML';
    setStatus('');
  }, 2500);
}

// ═══════════════════════════════════════════════════════════════════
//  SMART AUTO-DETECT
// ═══════════════════════════════════════════════════════════════════
async function runAutoDetect() {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      func: detectChatLayout,
    });
    const found = results[0]?.result;
    if (!found || !found.length) return;

    detectBanner.style.display = 'block';
    detectDesc.textContent = `Found ${found.length} section(s) on this page:`;
    detectSections.innerHTML = '';
    found.forEach(item => {
      const tag = document.createElement('div');
      tag.className = 'detect-tag';
      tag.textContent = item.label;
      tag.title = item.selector;
      tag.addEventListener('click', async () => {
        selectorInput.value = item.selector;
        pills.forEach(p => p.classList.remove('active'));
        document.querySelector('[data-mode="selector"]').classList.add('active');
        currentMode = 'selector';
        selectorRow.style.display = 'block';
        grabBtn.textContent = '⚡ Copy HTML';
        grabBtn.className = 'grab-btn';
        setStatus(`Selector set: ${item.selector}`, 'ok');
      });
      detectSections.appendChild(tag);
    });
  } catch(_) {}
}

// Injected into page — detects common chat layout patterns
function detectChatLayout() {
  const found = [];

  // Generic chat/message table
  const tables = document.querySelectorAll('table');
  tables.forEach((t, i) => {
    const rows = t.querySelectorAll('tr');
    if (rows.length > 2) {
      const id = t.id ? `#${t.id}` : (t.className ? `.${t.className.trim().split(' ')[0]}` : `table:nth-of-type(${i+1})`);
      found.push({ label: `Table (${rows.length} rows)`, selector: id });
    }
  });

  // Divs with background color hints (blue/gray = chat panels)
  const allDivs = document.querySelectorAll('div[style]');
  allDivs.forEach((d, i) => {
    const style = d.getAttribute('style') || '';
    if (style.includes('rgb(204, 204, 255)')) found.push({ label: '🟣 Customer panel', selector: `[style*="rgb(204, 204, 255)"]` });
    if (style.includes('rgb(255, 204, 204)')) found.push({ label: '🔴 Persona panel',  selector: `[style*="rgb(255, 204, 204)"]` });
    if (style.includes('rgb(223, 233, 246)')) found.push({ label: '🔵 Details panel',  selector: `[style*="rgb(223, 233, 246)"]` });
  });

  // Deduplicate by selector
  const seen = new Set();
  return found.filter(f => { if (seen.has(f.selector)) return false; seen.add(f.selector); return true; }).slice(0, 6);
}

// ═══════════════════════════════════════════════════════════════════
//  ELEMENT PICKER (injected into page)
// ═══════════════════════════════════════════════════════════════════
function injectPicker() {
  if (document.getElementById('__htmlgrabber_overlay__')) return;
  let hovered = null;

  const banner = document.createElement('div');
  banner.id = '__htmlgrabber_overlay__';
  banner.style.cssText = `position:fixed;top:0;left:0;right:0;background:rgba(0,255,136,0.92);color:#0d0d0d;font:700 13px monospace;text-align:center;padding:8px;z-index:2147483647;letter-spacing:1px;box-shadow:0 2px 12px rgba(0,0,0,.4);`;
  banner.textContent = '🎯 HTML GRABBER — hover & click any element  |  ESC to cancel';
  document.body.appendChild(banner);

  const hl = document.createElement('div');
  hl.style.cssText = `position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #00ff88;background:rgba(0,255,136,.08);border-radius:3px;transition:all .08s ease;box-shadow:0 0 0 1px rgba(0,255,136,.3);`;
  document.body.appendChild(hl);

  const label = document.createElement('div');
  label.style.cssText = `position:fixed;z-index:2147483647;background:#0d0d0d;color:#00ff88;font:700 10px monospace;padding:3px 7px;border-radius:3px;border:1px solid #00ff88;pointer-events:none;display:none;`;
  document.body.appendChild(label);

  function getXPath(el) {
    if (el.id) return `//*[@id="${el.id}"]`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      let idx = 1, sib = node.previousSibling;
      while (sib) { if (sib.nodeType === 1 && sib.tagName === node.tagName) idx++; sib = sib.previousSibling; }
      parts.unshift(`${node.tagName.toLowerCase()}[${idx}]`);
      node = node.parentNode;
    }
    return '/' + parts.join('/');
  }

  function onMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === banner || el === hl || el === label) return;
    hovered = el;
    const r = el.getBoundingClientRect();
    Object.assign(hl.style, { top: r.top+'px', left: r.left+'px', width: r.width+'px', height: r.height+'px' });
    label.style.display = 'block';
    label.style.top  = Math.max(0, r.top - 22) + 'px';
    label.style.left = r.left + 'px';
    label.textContent = `<${el.tagName.toLowerCase()}> ${el.id ? '#'+el.id : ''}${el.className && typeof el.className === 'string' ? '.'+el.className.trim().split(' ')[0] : ''}`;
  }

  function onClick(e) {
    if (!hovered || hovered === banner) return;
    e.preventDefault(); e.stopPropagation();

    // Serialize using same proper HTML format as full-page grab
    const SKIP_TAGS = new Set(['script','style','noscript','meta','link','head','template','slot']);
    const VOID_TAGS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
    const STYLE_PROPS = ['display','overflow','overflow-x','overflow-y','flex-direction','flex-wrap','flex','flex-grow','flex-shrink','justify-content','align-items','align-self','gap','position','top','right','bottom','left','z-index','width','height','min-width','max-width','min-height','max-height','padding','padding-top','padding-right','padding-bottom','padding-left','margin','margin-top','margin-right','margin-bottom','margin-left','border','border-top','border-right','border-bottom','border-left','border-radius','border-collapse','border-color','border-width','background-color','background-image','background-size','background-position','color','font-family','font-size','font-weight','font-style','line-height','letter-spacing','text-align','text-decoration','text-transform','white-space','word-break','vertical-align','cursor','opacity','box-sizing','user-select','resize','list-style','transform','aspect-ratio'];
    const SKIP_VALUES = new Set(['','auto','normal','none','initial','unset','inherit','static','inline','0px','0%','0','rgba(0, 0, 0, 0)','transparent','visible','start','left','top','separate','disc','outside']);
    const HTML_ATTRS = ['id','class','href','src','srcset','alt','placeholder','rows','cols','type','value','name','width','height','loading','decoding','data-nimg','role','aria-label'];

    function buildStyle(el) {
      const c = window.getComputedStyle(el), orig = el.getAttribute('style') || '';
      const map = new Map();
      STYLE_PROPS.forEach(p => { const v = c.getPropertyValue(p).trim(); if (v && !SKIP_VALUES.has(v)) map.set(p, v); });
      if (orig) orig.split(';').forEach(d => { const i=d.indexOf(':'); if(i===-1)return; const k=d.slice(0,i).trim(),v=d.slice(i+1).trim(); if(k&&v)map.set(k,v); });
      return Array.from(map.entries()).map(([k,v])=>`${k}:${v}`).join(';');
    }
    function esc(s){return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;');}
    function escT(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
    function ser(node, depth) {
      const ind = '    '.repeat(depth);
      if (node.nodeType===3){const t=node.textContent.replace(/\s+/g,' ').trim();return t?ind+escT(t)+'\n':'';}
      if (node.nodeType!==1)return '';
      const tag=node.tagName.toLowerCase(); if(SKIP_TAGS.has(tag))return '';
      const ap=[];
      const s=buildStyle(node); if(s)ap.push(`style="${esc(s)}"`);
      HTML_ATTRS.forEach(a=>{const v=node.getAttribute(a);if(v!==null&&v.trim())ap.push(`${a}="${esc(v.trim())}"`);});
      const as=ap.length?' '+ap.join(' '):'';
      if(VOID_TAGS.has(tag))return `${ind}<${tag}${as} />\n`;
      const kids=Array.from(node.childNodes);
      const textOnly=kids.every(c=>c.nodeType===3||(c.nodeType===1&&SKIP_TAGS.has(c.tagName.toLowerCase())));
      const txt=node.textContent.replace(/\s+/g,' ').trim();
      if(textOnly&&txt)return `${ind}<${tag}${as}>${escT(txt)}</${tag}>\n`;
      let out=`${ind}<${tag}${as}>\n`;
      for(const ch of kids)out+=ser(ch,depth+1);
      return out+`${ind}</${tag}>\n`;
    }

    const tree = ser(hovered, 0);
    const result = { html: tree, xpath: getXPath(hovered) };
    cleanup();
    sessionStorage.setItem('__htmlgrabber_picked__', JSON.stringify(result));
  }

  function onKey(e) {
    if (e.key === 'Escape') { cleanup(); sessionStorage.setItem('__htmlgrabber_cancelled__', '1'); }
  }

  function cleanup() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    banner.remove(); hl.remove(); label.remove();
  }

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
}

// ═══════════════════════════════════════════════════════════════════
//  HISTORY
// ═══════════════════════════════════════════════════════════════════
async function loadHistory() {
  const data = await chrome.storage.local.get('grab_history');
  return data.grab_history || [];
}

async function addToHistory(item) {
  let history = await loadHistory();
  history.unshift(item);
  if (history.length > 10) history = history.slice(0, 10);
  await chrome.storage.local.set({ grab_history: history });
}

async function renderHistory() {
  const history = await loadHistory();
  if (!history.length) {
    historyEmpty.style.display = 'block';
    historyList.style.display  = 'none';
    historyClear.style.display = 'none';
    return;
  }
  historyEmpty.style.display = 'none';
  historyList.style.display  = 'flex';
  historyClear.style.display = 'block';
  historyList.innerHTML = '';

  history.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'h-item';
    const date = new Date(item.ts);
    const timeStr = date.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) + ' ' + date.toLocaleDateString();
    div.innerHTML = `
      <div class="h-item-top">
        <div class="h-item-mode">${item.mode}</div>
        <div class="h-item-size">${item.sizeKB} KB</div>
      </div>
      <div class="h-item-url">${item.url}</div>
      <div class="h-item-time">${timeStr}</div>
      <div class="h-item-actions">
        <div class="h-action" data-idx="${i}" data-action="copy">📋 Copy</div>
        <div class="h-action" data-idx="${i}" data-action="save">💾 Save</div>
        ${item.xpath ? `<div class="h-action" data-idx="${i}" data-action="xpath">📍 XPath</div>` : ''}
        <div class="h-action red" data-idx="${i}" data-action="delete">✕</div>
      </div>`;
    historyList.appendChild(div);
  });

  // Action handlers
  historyList.querySelectorAll('.h-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const history = await loadHistory();
      const idx = parseInt(btn.dataset.idx);
      const item = history[idx];
      const action = btn.dataset.action;
      if (action === 'copy') {
        await navigator.clipboard.writeText(item.html);
        btn.textContent = '✓ Copied'; setTimeout(() => btn.textContent = '📋 Copy', 1500);
      } else if (action === 'save') {
        downloadHTML(item.html, item.url);
        btn.textContent = '✓ Saved'; setTimeout(() => btn.textContent = '💾 Save', 1500);
      } else if (action === 'xpath') {
        await navigator.clipboard.writeText(item.xpath);
        btn.textContent = '✓ Copied'; setTimeout(() => btn.textContent = '📍 XPath', 1500);
      } else if (action === 'delete') {
        history.splice(idx, 1);
        await chrome.storage.local.set({ grab_history: history });
        renderHistory();
      }
    });
  });
}

historyClear.addEventListener('click', async () => {
  await chrome.storage.local.set({ grab_history: [] });
  renderHistory();
});

// ═══════════════════════════════════════════════════════════════════
//  DIFF
// ═══════════════════════════════════════════════════════════════════
async function renderDiffSelects() {
  const history = await loadHistory();
  [diffA, diffB].forEach(sel => {
    sel.innerHTML = '<option value="">— Select grab —</option>';
    history.forEach((item, i) => {
      const date = new Date(item.ts);
      const label = `${item.mode} · ${item.sizeKB}KB · ${date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
      sel.innerHTML += `<option value="${i}">${label}</option>`;
    });
  });
}

diffBtn.addEventListener('click', async () => {
  const history = await loadHistory();
  const idxA = diffA.value, idxB = diffB.value;
  if (idxA === '' || idxB === '') { diffResult.innerHTML = '<div class="diff-empty">Select both grabs first.</div>'; return; }
  if (idxA === idxB) { diffResult.innerHTML = '<div class="diff-empty">Select two different grabs.</div>'; return; }

  const htmlA = history[idxA].html;
  const htmlB = history[idxB].html;

  // Simple line-by-line diff
  const linesA = htmlA.split('\n').map(l => l.trim()).filter(Boolean);
  const linesB = htmlB.split('\n').map(l => l.trim()).filter(Boolean);
  const setA = new Set(linesA);
  const setB = new Set(linesB);

  const added   = linesB.filter(l => !setA.has(l)).slice(0, 30);
  const removed = linesA.filter(l => !setB.has(l)).slice(0, 30);

  let html = '';
  if (!added.length && !removed.length) {
    html = '<div class="diff-empty">✓ No differences found.</div>';
  } else {
    if (removed.length) {
      html += `<div class="diff-removed" style="margin-bottom:6px;font-weight:700;">— Removed (${removed.length} lines)</div>`;
      removed.slice(0, 15).forEach(l => {
        html += `<div class="diff-removed">- ${escHtml(l.slice(0,80))}${l.length>80?'…':''}</div>`;
      });
    }
    if (added.length) {
      html += `<div class="diff-added" style="margin:8px 0 4px;font-weight:700;">+ Added (${added.length} lines)</div>`;
      added.slice(0, 15).forEach(l => {
        html += `<div class="diff-added">+ ${escHtml(l.slice(0,80))}${l.length>80?'…':''}</div>`;
      });
    }
  }
  diffResult.innerHTML = html;
});

// ═══════════════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════════════
async function loadSettings() {
  const data = await chrome.storage.local.get('settings');
  if (data.settings) settings = { ...settings, ...data.settings };
  document.getElementById('settingAutoDetect').checked  = settings.autoDetect;
  document.getElementById('settingHistory').checked     = settings.saveHistory;
  document.getElementById('settingXpath').checked       = settings.autoXpath;
  document.getElementById('settingTimestamp').checked   = settings.timestampFiles;
}

['settingAutoDetect','settingHistory','settingXpath','settingTimestamp'].forEach(id => {
  document.getElementById(id).addEventListener('change', async (e) => {
    const map = { settingAutoDetect:'autoDetect', settingHistory:'saveHistory', settingXpath:'autoXpath', settingTimestamp:'timestampFiles' };
    settings[map[id]] = e.target.checked;
    await chrome.storage.local.set({ settings });
    if (id === 'settingAutoDetect') {
      if (settings.autoDetect) runAutoDetect();
      else detectBanner.style.display = 'none';
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════
function downloadHTML(html, url) {
  const safeName = url.replace(/https?:\/\//, '').replace(/[^a-z0-9]/gi, '_').slice(0, 60);
  const ts = settings.timestampFiles ? '_' + new Date().toISOString().slice(0,19).replace(/:/g,'-') : '';
  const filename = `${safeName}${ts}.html`;
  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function showError(msg) {
  grabBtn.className = 'grab-btn error';
  grabBtn.textContent = '✗ Failed';
  setStatus(msg, 'err');
  setTimeout(() => {
    grabBtn.className = 'grab-btn';
    grabBtn.textContent = currentMode === 'pick' ? '🎯 Start Picking' : '⚡ Copy HTML';
    setStatus('');
  }, 3000);
}

function setLoading(label) { grabBtn.className = 'grab-btn loading'; grabBtn.textContent = label; setStatus(''); }
function setStatus(msg, type = '') { status.textContent = msg; status.className = 'status' + (type ? ' '+type : ''); }
function flashBtn(btn, label) { const orig = btn.textContent; btn.textContent = label; setTimeout(() => btn.textContent = orig, 1800); }
function escHtml(str) { return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Boot ──────────────────────────────────────────────────────────
init();
