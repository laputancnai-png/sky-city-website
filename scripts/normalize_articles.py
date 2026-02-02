#!/usr/bin/env python3
from pathlib import Path
from bs4 import BeautifulSoup
from dateutil import parser as dateparser
import argparse

TEMPLATE = Path('article_template.html').read_text(encoding='utf-8')

def normalize_article(path):
    p = Path(path)
    text = p.read_text(encoding='utf-8', errors='ignore')
    soup = BeautifulSoup(text, 'html.parser')
    # title: h2 in section
    h2 = soup.find('h2')
    title = h2.get_text(strip=True) if h2 else p.stem
    # date
    date_div = soup.find(class_='_a72d')
    date_text = date_div.get_text(strip=True) if date_div else ''
    try:
        dt = dateparser.parse(date_text)
        date_str = dt.strftime('%Y.%m.%d')
    except Exception:
        date_str = ''
    # content: take the <section> inner HTML if present, else body
    sec = soup.find('section')
    if sec:
        content_html = ''.join(str(c) for c in sec.contents)
    else:
        content_html = ''.join(str(c) for c in soup.body.contents) if soup.body else text
    # Fill template
    out = TEMPLATE.replace('{{TITLE}}', title).replace('{{DATE}}', date_str).replace('{{CONTENT}}', content_html)
    p.write_text(out, encoding='utf-8')

def main(articles_dir):
    p = Path(articles_dir)
    files = sorted(p.glob('article_fb_*.html'))
    for f in files:
        normalize_article(f)
    return len(files)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--articles', default='articles')
    args = parser.parse_args()
    n = main(args.articles)
    print(f'Normalized {n} fb articles in {args.articles}')
