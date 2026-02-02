#!/usr/bin/env python3
from pathlib import Path
from collections import defaultdict
import re
import argparse
import datetime

def collect_article_years(articles_dir):
    p = Path(articles_dir)
    files = list(p.glob('article_*.html'))
    years = defaultdict(set)
    for f in files:
        name = f.stem
        parts = name.split('_')
        date_token = None
        for tok in parts:
            if len(tok) == 8 and tok.isdigit():
                date_token = tok
                break
        if not date_token:
            continue
        try:
            dt = datetime.datetime.strptime(date_token, '%Y%m%d')
            years[dt.year].add(dt.month)
        except Exception:
            continue
    return years


def render_timeline_html(years_dict):
    out = []
    for year in sorted(years_dict.keys(), reverse=True):
        months = sorted(years_dict[year], reverse=True)
        out.append('    <li class="year-item">')
        out.append(f'      <span class="year-label" onclick="filterByYear(\'{year}\', this)">{year}</span>')
        out.append('      <ul class="month-list">')
        for m in months:
            mm = f"{m:02d}"
            out.append(f'        <li class="month-item" onclick="filterByMonth(\'{year}\',\'{mm}\',this)">{m}月</li>')
        out.append('      </ul>')
        out.append('    </li>')
    return '\n'.join(out)


def build_timeline_html(articles_dir):
    years = collect_article_years(articles_dir)
    return render_timeline_html(years)


def parse_existing_timeline(text):
    start = text.find('<ul class="timeline-list">')
    if start == -1:
        return {}
    ul_start = start + len('<ul class="timeline-list">')
    # find matching closing </ul> accounting for nested <ul>
    end = find_matching_closing_ul(text, start)
    if end == -1:
        return {}
    inner = text[ul_start:end]
    years = defaultdict(set)
    # find year blocks
    pattern = re.compile(r'<li class="year-item">\s*<span class="year-label"[^>]*>(\d{4})</span>\s*<ul class="month-list">(.*?)</ul>', re.S)
    for ymatch in pattern.finditer(inner):
        year = int(ymatch.group(1))
        months_block = ymatch.group(2)
        # find month numbers like '12月' or '2月'
        for m in re.findall(r'(\d{1,2})月', months_block):
            try:
                mi = int(m)
                if 1 <= mi <= 12:
                    years[year].add(mi)
            except ValueError:
                continue
    return years

def inject(home_path, html_snippet):
    home = Path(home_path)
    text = home.read_text(encoding='utf-8')
    start = text.find('<ul class="timeline-list">')
    if start == -1:
        raise SystemExit('timeline-list start not found')
    end = find_matching_closing_ul(text, start)
    if end == -1:
        raise SystemExit('timeline-list end not found')
    # replace the whole <ul class="timeline-list">...</ul> block
    new_block = '<ul class="timeline-list">\n' + html_snippet + '\n</ul>'
    # remove any stray markup between timeline and the diary section (likely leftover broken fragments)
    sect_pos = text.find('<section class="diary-section">', end)
    if sect_pos != -1:
        new_text = text[:start] + new_block + text[sect_pos:]
    else:
        new_text = text[:start] + new_block + text[end:]
    home.write_text(new_text, encoding='utf-8')


def find_matching_closing_ul(text, open_ul_pos):
    # open_ul_pos should point to the '<' of the opening <ul ...>
    i = open_ul_pos
    depth = 0
    # find each <ul and </ul> moving forward and track depth
    pattern = re.compile(r'<(/?)ul\b', re.I)
    for m in pattern.finditer(text, open_ul_pos):
        if m.group(1) == '':
            # found opening <ul
            depth += 1
        else:
            # found closing </ul>
            depth -= 1
        if depth == 0:
            # return index of '>' after this closing tag
            end_tag = text.find('>', m.end())
            return end_tag + 1 if end_tag != -1 else m.end()
    return -1


def collect_years_from_text(text):
    years = defaultdict(set)
    # find all year-item blocks
    blocks = re.findall(r'<li class="year-item">.*?</li>', text, re.S)
    for b in blocks:
        ym = re.search(r'<span class="year-label"[^>]*>(\d{4})</span>', b)
        if not ym:
            continue
        year = int(ym.group(1))
        for m in re.findall(r'(\d{1,2})月', b):
            try:
                mi = int(m)
                if 1 <= mi <= 12:
                    years[year].add(mi)
            except ValueError:
                continue
    return years

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--home', default='home.html')
    parser.add_argument('--articles', default='articles')
    args = parser.parse_args()
    home_path = args.home
    articles_path = args.articles
    home_text = Path(home_path).read_text(encoding='utf-8')
    existing = collect_years_from_text(home_text)
    article_years = collect_article_years(articles_path)
    # merge
    for y, months in article_years.items():
        existing[y].update(months)
    snippet = render_timeline_html(existing)
    # replace the timeline <ul> block in-place to avoid altering other parts
    inject(home_path, snippet)
    print('Timeline updated in', home_path)
