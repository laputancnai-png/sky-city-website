#!/usr/bin/env python3
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ART_DIR = ROOT / 'articles'

nav_re = re.compile(r"<nav class=\"nav-bar\">[\s\S]*?<\/nav>", re.IGNORECASE)
new_header = (
    '<header class="site-header" style="max-width:800px;margin:0 auto 24px;display:flex;align-items:center;justify-content:space-between;">\n'
    '  <div class="brand" style="display:flex;align-items:center;gap:10px;">\n'
    '    <a href="/" title="首页"><img src="/skycity_cutout.png" alt="logo" style="width:40px;height:40px;border-radius:6px;"/></a>\n'
    '    <a href="/" title="首页" style="text-decoration:none;color:var(--ink);font-weight:600;">天空之城</a>\n'
    '  </div>\n'
    '  <div class="auth-bar">{{AUTH_LINKS}}</div>\n'
    '</header>'
)

count = 0
for p in ART_DIR.rglob('*.html'):
    try:
        txt = p.read_text(encoding='utf-8')
    except Exception:
        continue
    if nav_re.search(txt):
        bak = p.with_suffix(p.suffix + '.bak')
        if not bak.exists():
            p.replace(bak)
            # restore original to txt variable
            txt = bak.read_text(encoding='utf-8')
        newtxt = nav_re.sub(new_header, txt, count=1)
        if newtxt != txt:
            p.write_text(newtxt, encoding='utf-8')
            count += 1

print(f'Updated {count} article files in {ART_DIR}')
