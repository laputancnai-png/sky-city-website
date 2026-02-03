#!/usr/bin/env python3
import sqlite3
from bs4 import BeautifulSoup
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CUR_DB = ROOT / 'articles.db'
BACKUP_DB = ROOT / 'articles.db.bak'

def extract_inner(content):
    soup = BeautifulSoup(content, 'html.parser')
    cont = soup.find('div', class_='article-content')
    if cont:
        return ''.join(str(c) for c in cont.contents)
    # fallback: if whole html given, return body contents
    body = soup.find('body')
    if body:
        return ''.join(str(c) for c in body.contents)
    return content

def main():
    if not BACKUP_DB.exists():
        print('Backup DB not found:', BACKUP_DB)
        return
    bconn = sqlite3.connect(str(BACKUP_DB))
    bcur = bconn.cursor()
    cconn = sqlite3.connect(str(CUR_DB))
    ccur = cconn.cursor()

    bcur.execute("SELECT slug, content FROM articles WHERE content LIKE '%<img%' OR content LIKE '%<video%'")
    rows = bcur.fetchall()
    restored = 0
    for slug, content in rows:
        inner = extract_inner(content)
        # check current DB
        ccur.execute('SELECT id, content FROM articles WHERE slug = ?', (slug,))
        r = ccur.fetchone()
        if not r:
            continue
        cur_id, cur_content = r
        # if current content lacks media, restore
        if cur_content is None or ('<img' not in cur_content and '<video' not in cur_content):
            ccur.execute('UPDATE articles SET content = ? WHERE id = ?', (inner, cur_id))
            if ccur.rowcount:
                restored += 1

    cconn.commit()
    bconn.close()
    cconn.close()
    print(f'Restored content with media for {restored} articles')

if __name__ == '__main__':
    main()
