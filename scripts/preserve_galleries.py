#!/usr/bin/env python3
from bs4 import BeautifulSoup
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
ART_DIR = ROOT / 'articles'
DB_PATH = ROOT / 'articles.db'

BLOCK_TAGS = ['figure','div','section','article','p','footer']

def nearest_block(tag, container):
    cur = tag
    while cur and cur != container and cur.name not in BLOCK_TAGS:
        cur = cur.parent
    return cur if cur and cur != container else tag

def build_fragment(container):
    # Collect title/header if present
    parts = []
    header = container.find(['h1','h2','h3'])
    if header:
        parts.append(str(header))

    media_tags = container.find_all(['img','video'])
    seen = set()
    for m in media_tags:
        blk = nearest_block(m, container)
        # use the block element (string) as key to avoid duplicates
        key = str(blk)
        if key in seen:
            continue
        seen.add(key)
        parts.append(str(blk))

    # Append location/hashtags paragraphs near end
    for el in container.find_all(True):
        txt = el.get_text(separator=' ', strip=True)
        if 'Place:' in txt or '#' in txt:
            parts.append(str(el))

    # Fallback: if nothing collected, return full container inner
    if not parts:
        return ''.join(str(c) for c in container.contents)
    return '\n'.join(parts)

def main():
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    updated = 0
    for p in sorted(ART_DIR.glob('*.html')):
        s = BeautifulSoup(p.read_text(encoding='utf-8'), 'html.parser')
        cont = s.find('div', class_='article-content')
        if not cont:
            continue
        frag = build_fragment(cont)
        # Update file: replace inner HTML of content div
        cont.clear()
        newfrag = BeautifulSoup(frag, 'html.parser')
        for c in newfrag.contents:
            cont.append(c)
        p.write_text(str(s), encoding='utf-8')
        # Update DB
        slug = p.name[:-5]
        cur.execute('UPDATE articles SET content = ? WHERE slug = ?', (frag, slug))
        if cur.rowcount:
            updated += 1
    conn.commit()
    conn.close()
    print(f'Processed {len(list(ART_DIR.glob("*.html")))} files, updated DB for {updated} articles')

if __name__ == '__main__':
    main()
