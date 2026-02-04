#!/usr/bin/env python3
import sys
from pathlib import Path
import re
import shutil
import urllib.request

try:
    from bs4 import BeautifulSoup
except Exception:
    BeautifulSoup = None

try:
    import requests
except Exception:
    requests = None

try:
    from PIL import Image
except Exception:
    Image = None


def ensure_dir(p: Path):
    p.mkdir(parents=True, exist_ok=True)


def download_url(url, dest: Path):
    if requests:
        r = requests.get(url, stream=True, timeout=30)
        r.raise_for_status()
        with open(dest, 'wb') as f:
            for chunk in r.iter_content(8192):
                f.write(chunk)
    else:
        urllib.request.urlretrieve(url, str(dest))


def make_thumb(src_path: Path, dst_path: Path, width=360):
    if Image is None:
        # fallback: copy
        shutil.copy2(src_path, dst_path)
        return
    try:
        with Image.open(src_path) as im:
            orig_mode = im.mode
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert('RGB')
            w, h = im.size
            if w <= width:
                im.save(dst_path, quality=85)
            else:
                new_h = int(h * (width / float(w)))
                im.thumbnail((width, new_h))
                im.save(dst_path, quality=85)
    except Exception as e:
        shutil.copy2(src_path, dst_path)


IGNORE_PREFIXES = ('data:', 'javascript:')


def process_article(article_path: Path):
    repo_root = article_path.parent.parent
    html = article_path.read_text(encoding='utf-8')

    # parse
    soup = None
    if BeautifulSoup:
        soup = BeautifulSoup(html, 'html.parser')
    else:
        # rudimentary extraction using regex
        imgs = re.findall(r'<img[^>]+src=["\']([^"\']+)["\']', html, flags=re.I)
        print('Found', len(imgs), 'images (regex mode).')
        # fallback: do nothing beyond listing
        return

    content = soup.select_one('.article-content') or soup
    imgs = content.find_all('img')
    if not imgs:
        print('No images found in article content.')
        return

    dest_dir = repo_root / 'articles' / 'media' / article_path.stem
    ensure_dir(dest_dir)

    anchors = []
    modified = False

    for img in imgs:
        src = img.get('src')
        if not src or src.startswith(IGNORE_PREFIXES):
            continue
        # treat emoticons or local theme assets as skip (e.g., /rte/)
        if src.startswith('/') and (src.startswith('/rte') or src.startswith('/static') or 'skycity_cutout' in src):
            # leave alone
            continue

        # normalize //domain/path -> https://domain/path
        if src.startswith('//'):
            src = 'https:' + src

        # determine filename
        filename = Path(src).name
        if not filename:
            # generate name
            filename = f'image_{len(anchors)+1}.jpg'

        local_full = dest_dir / filename
        local_thumb = dest_dir / (Path(filename).stem + '_thumb' + Path(filename).suffix)

        try:
            if src.startswith('http'):
                print('Downloading', src, '->', local_full)
                download_url(src, local_full)
            else:
                # relative path: try to copy from repo root
                candidate = repo_root / src.lstrip('/')
                if candidate.exists():
                    print('Copying local', candidate, '->', local_full)
                    shutil.copy2(candidate, local_full)
                else:
                    # try treating src as relative to article folder
                    candidate2 = article_path.parent / src
                    if candidate2.exists():
                        print('Copying local', candidate2, '->', local_full)
                        shutil.copy2(candidate2, local_full)
                    else:
                        print('Warning: image not found locally and not http:', src)
                        continue

            # create thumbnail
            make_thumb(local_full, local_thumb)

            # create anchor wrapper
            a = soup.new_tag('a', href=str(Path('articles') / 'media' / article_path.stem / filename))
            a['class'] = 'img-thumb'
            # remove target/rel if present
            if 'target' in a.attrs: del a['target']
            if 'rel' in a.attrs: del a['rel']

            # replace img src to point to thumbnail path
            img['src'] = str(Path('articles') / 'media' / article_path.stem / local_thumb.name)
            a.append(img.extract())
            anchors.append(a)
            modified = True
        except Exception as e:
            print('Failed to process image', src, e)

    # insert gallery if we have anchors
    if anchors:
        gallery = soup.new_tag('div')
        gallery['class'] = 'img-gallery'
        for a in anchors:
            gallery.append(a)

        # find insertion point: before first anchor's original parent paragraph if possible
        first_img = soup.select_one('.article-content img')
        if first_img:
            parent_block = first_img.find_parent(['p', 'div'])
            if parent_block and parent_block.parent:
                parent_block.insert_before(gallery)
            else:
                content.insert(0, gallery)
        else:
            content.insert(0, gallery)

    if modified:
        backup = article_path.with_suffix(article_path.suffix + '.bak')
        if not backup.exists():
            shutil.copy2(article_path, backup)
        article_path.write_text(str(soup), encoding='utf-8')
        print('Updated article:', article_path)
    else:
        print('No changes made to', article_path)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: process_wp_images.py path/to/article.html')
        sys.exit(2)
    p = Path(sys.argv[1])
    if not p.exists():
        print('Article not found:', p)
        sys.exit(1)
    process_article(p)
