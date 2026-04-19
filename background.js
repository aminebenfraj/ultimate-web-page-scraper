// background.js — handles keyboard shortcut commands

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  if (command === 'grab-full-page') {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const SKIP_TAGS = new Set(['script','style','noscript','meta','link','head','template','slot']);
        const VOID_TAGS = new Set(['area','base','br','col','embed','hr','img','input','param','source','track','wbr']);
        const STYLE_PROPS = ['display','overflow','overflow-x','overflow-y','flex-direction','flex-wrap','flex','flex-grow','flex-shrink','justify-content','align-items','align-self','gap','position','top','right','bottom','left','z-index','width','height','min-width','max-width','min-height','max-height','padding','padding-top','padding-right','padding-bottom','padding-left','margin','margin-top','margin-right','margin-bottom','margin-left','border','border-radius','border-collapse','border-color','border-width','background-color','background-image','color','font-size','font-weight','font-style','line-height','text-align','text-decoration','text-transform','white-space','vertical-align','cursor','opacity','box-sizing','user-select','resize','list-style','transform'];
        const SKIP_VALUES = new Set(['','auto','normal','none','initial','unset','inherit','static','inline','0px','0%','0','rgba(0, 0, 0, 0)','transparent','visible','start','left','top','separate','disc','outside']);
        const HTML_ATTRS = ['id','class','href','src','srcset','alt','placeholder','rows','type','value','name','width','height','loading','decoding','data-nimg'];
        function buildStyle(el){const c=window.getComputedStyle(el),orig=el.getAttribute('style')||'',map=new Map();STYLE_PROPS.forEach(p=>{const v=c.getPropertyValue(p).trim();if(v&&!SKIP_VALUES.has(v))map.set(p,v);});if(orig)orig.split(';').forEach(d=>{const i=d.indexOf(':');if(i===-1)return;const k=d.slice(0,i).trim(),v=d.slice(i+1).trim();if(k&&v)map.set(k,v);});return Array.from(map.entries()).map(([k,v])=>`${k}:${v}`).join(';');}
        function esc(s){return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;');}
        function escT(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
        function ser(node,depth){const ind='    '.repeat(depth);if(node.nodeType===3){const t=node.textContent.replace(/\s+/g,' ').trim();return t?ind+escT(t)+'\n':'';}if(node.nodeType!==1)return '';const tag=node.tagName.toLowerCase();if(SKIP_TAGS.has(tag))return '';const ap=[];const s=buildStyle(node);if(s)ap.push(`style="${esc(s)}"`);HTML_ATTRS.forEach(a=>{const v=node.getAttribute(a);if(v!==null&&v.trim())ap.push(`${a}="${esc(v.trim())}"`);});const as=ap.length?' '+ap.join(' '):'';if(VOID_TAGS.has(tag))return `${ind}<${tag}${as} />\n`;const kids=Array.from(node.childNodes);const textOnly=kids.every(c=>c.nodeType===3||(c.nodeType===1&&SKIP_TAGS.has(c.tagName.toLowerCase())));const txt=node.textContent.replace(/\s+/g,' ').trim();if(textOnly&&txt)return `${ind}<${tag}${as}>${escT(txt)}</${tag}>\n`;let out=`${ind}<${tag}${as}>\n`;for(const ch of kids)out+=ser(ch,depth+1);return out+`${ind}</${tag}>\n`;}
        return '<html>\n\n<head></head>\n\n' + ser(document.body, 0) + '\n</html>';
      },
    });
    const html = results[0]?.result;
    if (!html) return;

    // Store in chrome.storage for popup to read, and copy via content script
    await chrome.storage.local.set({ __shortcut_html__: html, __shortcut_ts__: Date.now() });

    // Show badge feedback
    chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#00ff88', tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 2000);
  }

  if (command === 'start-picker') {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectPickerFromBackground,
    });
  }
});

// Picker injected via keyboard shortcut (same logic as popup picker)
function injectPickerFromBackground() {
  if (document.getElementById('__htmlgrabber_overlay__')) return;

  let hovered = null;

  const banner = document.createElement('div');
  banner.id = '__htmlgrabber_overlay__';
  banner.style.cssText = `
    position:fixed;top:0;left:0;right:0;
    background:rgba(0,255,136,0.92);color:#0d0d0d;
    font:700 13px monospace;text-align:center;padding:8px;
    z-index:2147483647;letter-spacing:1px;
    box-shadow:0 2px 12px rgba(0,0,0,0.4);
  `;
  banner.textContent = '🎯 HTML GRABBER — hover & click any element  |  ESC to cancel';
  document.body.appendChild(banner);

  const highlight = document.createElement('div');
  highlight.style.cssText = `
    position:fixed;pointer-events:none;z-index:2147483646;
    border:2px solid #00ff88;background:rgba(0,255,136,0.08);
    border-radius:3px;transition:all 0.08s ease;
    box-shadow:0 0 0 1px rgba(0,255,136,0.3);
  `;
  document.body.appendChild(highlight);

  function onMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === banner || el === highlight) return;
    hovered = el;
    const r = el.getBoundingClientRect();
    Object.assign(highlight.style, { top: r.top+'px', left: r.left+'px', width: r.width+'px', height: r.height+'px' });
  }

  function onClick(e) {
    if (!hovered || hovered === banner) return;
    e.preventDefault(); e.stopPropagation();
    cleanup();
    sessionStorage.setItem('__htmlgrabber_picked__', hovered.outerHTML);
  }

  function onKey(e) {
    if (e.key === 'Escape') { cleanup(); sessionStorage.setItem('__htmlgrabber_cancelled__', '1'); }
  }

  function cleanup() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    banner.remove(); highlight.remove();
  }

  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
}
