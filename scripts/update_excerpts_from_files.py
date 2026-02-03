#!/usr/bin/env python3
from bs4 import BeautifulSoup
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
ART_DIR = ROOT / 'articles'
DB_PATH = ROOT / 'articles.db'

def calc_excerpt(text: str, length: int = 160) -> str:
    t = ' '.join(text.split())
    if len(t) <= length:
        return t
    cut = t[:length].rsplit(' ', 1)[0]
    return cut + '...'

def main():
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    updated = 0
    for p in sorted(ART_DIR.glob('*.html')):
        slug = p.name[:-5]
        s = BeautifulSoup(p.read_text(encoding='utf-8'), 'html.parser')
        content_div = s.find('div', class_='article-content')
        if not content_div:
            continue
        text = content_div.get_text(separator=' ', strip=True)
        if not text:
            continue
        excerpt = calc_excerpt(text, 160)
        cur.execute('UPDATE articles SET excerpt = ? WHERE slug = ?', (excerpt, slug))
        if cur.rowcount:
            updated += 1
    conn.commit()
    conn.close()
    print(f'Updated excerpts for {updated} articles.')

if __name__ == '__main__':
    main()
