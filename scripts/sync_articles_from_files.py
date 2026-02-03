#!/usr/bin/env python3
import sqlite3
from pathlib import Path
import datetime
import re

DB = Path('articles.db')
ART_DIR = Path('articles')

def extract_meta_from_file(p: Path):
    text = p.read_text(encoding='utf-8')
    # try title
    m = re.search(r'<h1[^>]*>(.*?)</h1>', text, re.S)
    title = m.group(1).strip() if m else p.stem
    # try date in file
    m2 = re.search(r'data-year="(\d{4})"\s+data-month="(\d{2})"', text)
    pub_date = None
    if m2:
        y = int(m2.group(1)); mm = int(m2.group(2))
        pub_date = datetime.datetime(y, mm, 1).isoformat()
    else:
        # fallback: parse date token from filename
        m3 = re.search(r'(\d{8})', p.name)
        if m3:
            dt = datetime.datetime.strptime(m3.group(1), '%Y%m%d')
            pub_date = dt.isoformat()
    # excerpt: first text content
    txt = re.sub(r'<[^>]+>', '', text)
    excerpt = ' '.join(txt.split())[:160]
    return title, pub_date or datetime.datetime.now().isoformat(), text, excerpt

def main():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    files = sorted(ART_DIR.glob('article_fb_*.html'))
    inserted = 0
    for f in files:
        slug = f.stem
        cur.execute('SELECT COUNT(1) FROM articles WHERE slug = ?', (slug,))
        if cur.fetchone()[0] > 0:
            continue
        title, pub_date, content, excerpt = extract_meta_from_file(f)
        cur.execute('INSERT INTO articles (title, content, pub_date, slug, excerpt) VALUES (?,?,?,?,?)',
                    (title, content, pub_date, slug, excerpt))
        inserted += 1
    conn.commit()
    conn.close()
    print(f'Inserted {inserted} articles into DB')

if __name__ == '__main__':
    main()
