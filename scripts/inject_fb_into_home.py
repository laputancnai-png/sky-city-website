#!/usr/bin/env python3
from pathlib import Path
from bs4 import BeautifulSoup
from dateutil import parser as dateparser
import argparse
import html

CARD_CLASSES = ['card--blue','card--teal','card--rust','card--moss','card--gold','card--sky']

def make_card_html(fname, title, date, excerpt, cls):
    year = date.strftime('%Y')
    month = date.strftime('%m')
    date_str = date.strftime('%Y.%m.%d')
    safe_title = html.escape(title)
    safe_excerpt = html.escape(excerpt)
    onclick = f"window.location.href='articles/{fname}'"
    return f'''    <div class="diary-card {cls} reveal" 
         data-year="{year}" 
         data-month="{month}"
         onclick="{onclick}">
      <span class="card-tag">日志</span>
      <div class="card-date">{date_str}</div>
      <h3 class="card-title">{safe_title}</h3>
      <p class="card-text">{safe_excerpt}</p>
      <div class="card-watercolor"></div>
    </div>
'''

def extract_meta(article_path):
    text = Path(article_path).read_text(encoding='utf-8', errors='ignore')
    soup = BeautifulSoup(text, 'html.parser')
    # title may be in <title>
    title_tag = soup.find('h2')
    title = title_tag.get_text(strip=True) if title_tag else ''
    # excerpt: first ._2pin div text
    excerpt = ''
    pin = soup.find(class_='_2pin')
    if pin:
        excerpt = ' '.join(pin.stripped_strings)
    # date: look for div._a72d or <title>
    date = None
    date_div = soup.find(class_='_a72d')
    if date_div:
        try:
            date = dateparser.parse(date_div.get_text(strip=True))
        except Exception:
            date = None
    if not date:
        # try <title>
        t = soup.find('title')
        if t:
            try:
                date = dateparser.parse(t.get_text(strip=True))
            except Exception:
                date = None
    if not date:
        date = dateparser.parse('1970-01-01')
    if not title:
        title = Path(article_path).stem
    if not excerpt:
        excerpt = ''
    # keep excerpt to 160 chars
    if len(excerpt) > 160:
        excerpt = excerpt[:157].rstrip() + '...'
    return title, date, excerpt

def inject(home_path, articles_dir):
    home = Path(home_path)
    backup = home.with_suffix('.html.bak')
    if not backup.exists():
        home.write_text(home.read_text(encoding='utf-8'), encoding='utf-8')
        home.rename(backup)
        # restore original to continue edits
        backup.write_text(backup.read_text(encoding='utf-8'), encoding='utf-8')
        home.write_text(backup.read_text(encoding='utf-8'), encoding='utf-8')
    # read current (from backup) to avoid repeated injections
    content = backup.read_text(encoding='utf-8')
    marker_start = '<div class="diary-grid" id="diary-grid">'
    if marker_start not in content:
        raise SystemExit('diary-grid marker not found in home.html')
    insert_point = content.find(marker_start) + len(marker_start)
    # build cards from articles
    articles = sorted(Path(articles_dir).glob('article_fb_*.html'), reverse=True)
    cards = []
    for i, a in enumerate(articles):
        fname = a.name
        title, date, excerpt = extract_meta(a)
        cls = CARD_CLASSES[i % len(CARD_CLASSES)]
        card = make_card_html(fname, title, date, excerpt, cls)
        cards.append((date, card))
    # sort cards by date desc
    cards.sort(key=lambda x: x[0], reverse=True)
    cards_html = '\n'.join(c for _, c in cards)
    # wrap with markers so we can replace later
    wrapped = '\n<!-- FB-IMPORT-START -->\n' + cards_html + '\n<!-- FB-IMPORT-END -->\n'
    # if existing markers exist, replace between them
    if '<!-- FB-IMPORT-START -->' in content and '<!-- FB-IMPORT-END -->' in content:
        pre = content.split('<!-- FB-IMPORT-START -->',1)[0]
        post = content.split('<!-- FB-IMPORT-END -->',1)[1]
        new_content = pre + wrapped + post
    else:
        new_content = content[:insert_point] + '\n' + wrapped + content[insert_point:]
    home.write_text(new_content, encoding='utf-8')
    return len(cards)

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--home', default='home.html')
    p.add_argument('--articles', default='articles')
    args = p.parse_args()
    n = inject(args.home, args.articles)
    print(f'Inserted {n} facebook post cards into {args.home}')
