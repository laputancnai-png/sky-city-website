#!/usr/bin/env python3
"""Clean nested HTML inside article files and update DB excerpts.

If an article's `.article-content` contains a full HTML document (e.g. another
<!DOCTYPE> / <html> ...), this script replaces the `.article-content` with
only the inner body of that nested document. It then recalculates the excerpt
and updates the `articles` table in `articles.db`.

Run from the repo root: `python3 scripts/clean_nested_html_in_articles.py`
"""
import sqlite3
from pathlib import Path
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
ART_DIR = ROOT / 'articles'
DB_PATH = ROOT / 'articles.db'

def clean_article_file(path: Path) -> str:
    html = path.read_text(encoding='utf-8')
    soup = BeautifulSoup(html, 'html.parser')
    content_div = soup.find('div', class_='article-content')
    if content_div is None:
        return ''

    inner_html = str(content_div)
    # Detect nested full document
    if '<!doctype' in inner_html.lower() or inner_html.lower().find('<html') != -1:
        # Parse nested HTML and extract body contents
        nested = BeautifulSoup(inner_html, 'html.parser')
        nested_html_tag = nested.find('html')
        if nested_html_tag:
            nested_body = nested_html_tag.find('body')
        else:
            nested_body = nested.find('body')

        if nested_body:
            new_contents = ''.join(str(c) for c in nested_body.contents)
            # Replace the contents of the article-content div
            content_div.clear()
            content_div.append(BeautifulSoup(new_contents, 'html.parser'))
            path.write_text(str(soup), encoding='utf-8')
            # Return cleaned text for excerpting
            return content_div.get_text(separator=' ', strip=True)
    # Nothing changed, return current text
    return content_div.get_text(separator=' ', strip=True)

def calc_excerpt(text: str, length: int = 160) -> str:
    t = ' '.join(text.split())
    if len(t) <= length:
        return t
    # cut on word boundary
    cut = t[:length].rsplit(' ', 1)[0]
    return cut + '...'

def main():
    files = sorted(ART_DIR.glob('article_fb_*.html'))
    if not files:
        print('No FB article files found in articles/.')
        return
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    updated = 0
    for f in files:
        cleaned_text = clean_article_file(f)
        if not cleaned_text:
            continue
        excerpt = calc_excerpt(cleaned_text, 160)
        # Update DB row matching filename (filename stored in `filename` or `path` column)
        # Try common column names: `filename`, `path`, `file`.
        updated_rows = 0
        for col in ('filename', 'path', 'file'):
            try:
                cur.execute(f"UPDATE articles SET excerpt = ? WHERE {col} = ?", (excerpt, f.name))
                updated_rows = cur.rowcount
                if updated_rows:
                    break
            except sqlite3.OperationalError:
                continue
        # Fallback: try matching by title and date if no file column
        if not updated_rows:
            # attempt to match by title contained in file
            soup = BeautifulSoup(f.read_text(encoding='utf-8'), 'html.parser')
            title = soup.find('h1', class_='article-title')
            date = soup.find('div', class_='article-date')
            if title:
                t = title.get_text(strip=True)
                if date:
                    d = date.get_text(strip=True)
                    cur.execute("UPDATE articles SET excerpt = ? WHERE title = ? AND pub_date LIKE ?", (excerpt, t, f"%{d}%"))
                else:
                    cur.execute("UPDATE articles SET excerpt = ? WHERE title = ?", (excerpt, t))
        updated += 1

    conn.commit()
    conn.close()
    print(f'Processed {len(files)} files, updated excerpts for {updated} files.')

if __name__ == '__main__':
    main()
