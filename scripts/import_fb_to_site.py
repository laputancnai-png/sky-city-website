#!/usr/bin/env python3
from pathlib import Path
from bs4 import BeautifulSoup
import shutil
import argparse


def import_posts(extracted_dir, site_articles_dir):
    extracted = Path(extracted_dir)
    articles = Path(site_articles_dir)
    if not extracted.exists():
        raise SystemExit(f'extracted dir not found: {extracted}')
    articles.mkdir(parents=True, exist_ok=True)
    media_src = extracted / 'media'
    media_dst = articles / 'facebook_media'
    # copy media tree if exists
    if media_src.exists():
        if media_dst.exists():
            # merge: copy files, overwrite if needed
            for src in media_src.rglob('*'):
                if src.is_file():
                    rel = src.relative_to(media_src)
                    dest = media_dst / rel
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dest)
        else:
            shutil.copytree(media_src, media_dst)

    count = 0
    for f in sorted(extracted.glob('*.html')):
        # skip if somehow target exists
        orig_name = f.name
        target_name = f'article_fb_{orig_name}'
        target_path = articles / target_name
        html = f.read_text(encoding='utf-8', errors='ignore')
        soup = BeautifulSoup(html, 'html.parser')
        # fix local media paths: media/... -> facebook_media/...
        for tag in soup.find_all(True):
            for attr in ('src', 'href'):
                val = tag.get(attr)
                if not val:
                    continue
                if val.startswith('media/') or '/media/' in val:
                    # normalize: take part after 'media/' and prepend facebook_media/
                    if 'media/' in val:
                        remainder = val.split('media/', 1)[1]
                    else:
                        remainder = val
                    tag[attr] = str(Path('facebook_media') / remainder)
        target_path.write_text(str(soup), encoding='utf-8')
        count += 1
    return count


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--extracted', default='facebook_posts_extracted')
    p.add_argument('--articles', default='articles')
    args = p.parse_args()
    n = import_posts(args.extracted, args.articles)
    print(f'Imported {n} posts into {args.articles} (media in {args.articles}/facebook_media/)')
