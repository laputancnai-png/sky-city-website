#!/usr/bin/env python3
from bs4 import BeautifulSoup
from dateutil import parser as dateparser
from pathlib import Path
import argparse

TEMPLATE = """<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>{title}</title>
</head>
<body>
{body}
</body>
</html>
"""


def extract_posts(src_path, out_dir, chronological='asc'):
    src = Path(src_path)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    html = src.read_text(encoding='utf-8', errors='ignore')
    soup = BeautifulSoup(html, 'html.parser')
    sections = soup.find_all('section', class_='_a6-g')
    items = []
    for i, sec in enumerate(sections):
        # try to find the footer date
        date_div = sec.find('div', class_='_a72d')
        date_text = date_div.get_text(strip=True) if date_div else ''
        try:
            dt = dateparser.parse(date_text)
        except Exception:
            dt = None
        items.append((dt, i, sec))
    # sort: None dates go to end
    items.sort(key=lambda x: (x[0] is None, x[0] if x[0] else 0))
    if chronological == 'desc':
        items.reverse()
    written = 0
    for dt, idx, sec in items:
        if dt:
            fname_time = dt.strftime('%Y%m%d_%H%M%S')
            title = dt.isoformat()
        else:
            fname_time = f'unknown_{idx}'
            title = 'unknown_date'
        filename = f'{fname_time}_{idx}.html'
        path = out / filename
        # Copy local media referenced in this section into output and fix links
        archive_root = src.parents[2] if len(src.parents) >= 3 else src.parent
        # work on a copy to avoid mutating original soup
        sec_copy = BeautifulSoup(str(sec), 'html.parser')
        for tag in sec_copy.find_all(True):
            for attr in ('src', 'href'):
                val = tag.get(attr)
                if not val:
                    continue
                # skip absolute URLs
                if val.startswith('http://') or val.startswith('https://'):
                    continue
                # handle typical archive media paths that include 'posts/media'
                if 'posts/media/' in val:
                    remainder = val.split('posts/media/', 1)[1]
                    src_file = archive_root / val
                    dest = out / 'media' / remainder
                    try:
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        if src_file.exists():
                            import shutil
                            shutil.copy2(src_file, dest)
                            # set relative path from output html to media
                            tag[attr] = str(Path('media') / remainder)
                        else:
                            # if file missing, leave path as-is
                            pass
                    except Exception:
                        pass
        body = str(sec_copy)
        path.write_text(TEMPLATE.format(title=title, body=body), encoding='utf-8')
        written += 1
    return written


if __name__ == '__main__':
    p = argparse.ArgumentParser(description='Extract Facebook archive posts into separate files')
    p.add_argument('--src', default='facebook_archive/your_facebook_activity/posts/your_posts__check_ins__photos_and_videos_1.html')
    p.add_argument('--out', default='facebook_posts_extracted')
    p.add_argument('--order', choices=['asc','desc'], default='asc', help='asc = oldest first')
    args = p.parse_args()
    count = extract_posts(args.src, args.out, args.order)
    print(f'Wrote {count} post files to {args.out}')
