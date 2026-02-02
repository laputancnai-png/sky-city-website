#!/usr/bin/env python3
from pathlib import Path
from bs4 import BeautifulSoup
import shutil
import argparse

def is_empty_post(path):
    text = path.read_text(encoding='utf-8', errors='ignore')
    soup = BeautifulSoup(text, 'html.parser')
    # check normalized title
    h1 = soup.find('h1', class_='article-title')
    if h1 and 'Yao Min posted something via Microsoft' in h1.get_text():
        return True
    # fallback: check h2 from original facebook section
    h2 = soup.find('h2')
    if h2 and 'Yao Min posted something via Microsoft' in h2.get_text():
        return True
    # check for minimal content: no paragraph text or very short
    content = soup.find(class_='article-content') or soup.find('section')
    if content:
        text_content = ''.join(content.stripped_strings)
        if len(text_content) < 30:
            return True
    return False

def clean(articles_dir):
    p = Path(articles_dir)
    removed_dir = p / 'removed_empty_fb'
    removed_dir.mkdir(parents=True, exist_ok=True)
    files = list(p.glob('article_fb_*.html'))
    removed = []
    for f in files:
        try:
            if is_empty_post(f):
                dest = removed_dir / f.name
                shutil.move(str(f), str(dest))
                removed.append(f.name)
        except Exception:
            continue
    return removed

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--articles', default='articles')
    args = parser.parse_args()
    removed = clean(args.articles)
    print(f'Moved {len(removed)} files to {args.articles}/removed_empty_fb')
    if removed:
        for n in removed:
            print(' -', n)
