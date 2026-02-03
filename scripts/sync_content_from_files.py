#!/usr/bin/env python3
from bs4 import BeautifulSoup
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
ART_DIR = ROOT / 'articles'
DB_PATH = ROOT / 'articles.db'

def main():
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    updated = 0
    for p in sorted(ART_DIR.glob('*.html')):
        slug = p.name[:-5]
        s = BeautifulSoup(p.read_text(encoding='utf-8'), 'html.parser')
        cont = s.find('div', class_='article-content')
        if not cont:
            continue
        inner_html = ''.join(str(c) for c in cont.contents)
        # Update content in DB for matching slug
        cur.execute('UPDATE articles SET content = ? WHERE slug = ?', (inner_html, slug))
        if cur.rowcount:
            updated += 1
    conn.commit()
    conn.close()
    print(f'Updated content for {updated} articles in DB')

if __name__ == '__main__':
    main()
