#!/usr/bin/env python3
from bs4 import BeautifulSoup
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
ART_DIR = ROOT / 'articles'
DB_PATH = ROOT / 'articles.db'

def find_best_candidate(container):
    # Prefer elements containing images or video.
    media = list(container.find_all(['img', 'video', 'picture', 'iframe']))
    if media:
        # If multiple media, find their lowest common ancestor (LCA) inside container
        if len(media) > 1:
            ancestor_lists = []
            for m in media:
                ancestors = []
                cur = m
                while cur and cur != container:
                    ancestors.append(cur)
                    cur = cur.parent
                ancestors.append(container)
                ancestor_lists.append(list(reversed(ancestors)))

            lca = container
            for elems in zip(*ancestor_lists):
                if all(e == elems[0] for e in elems):
                    lca = elems[0]
                else:
                    break

            # If LCA is useful, collect all its direct children that contain media
            if lca:
                candidates = []
                for child in lca.find_all(recursive=False):
                    if child.find(['img', 'video', 'picture', 'iframe']):
                        candidates.append(child)
                if candidates:
                    # return a fragment containing those children in order
                    frag = ''.join(str(c) for c in candidates)
                    return BeautifulSoup(f'<div>{frag}</div>', 'html.parser').div

        # If single media or no multi-child candidates, return nearest reasonable ancestor
        first = media[0]
        anc = first
        while anc and anc != container and anc.name not in ('div', 'section', 'article'):
            anc = anc.parent
        if anc and anc != container:
            return anc
        return first.parent or container

    # fallback: find element with hashtags or 'Place:' text
    for el in container.find_all(True):
        txt = el.get_text(separator=' ', strip=True)
        if '#' in txt or 'Place:' in txt or 'Photos' in txt:
            return el
    # fallback: the container itself
    return container

def main():
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    updated = 0
    for p in sorted(ART_DIR.glob('*.html')):
        slug = p.name[:-5]
        s = BeautifulSoup(p.read_text(encoding='utf-8'), 'html.parser')
        cont = s.find('div', class_='article-content')
        if not cont:
            continue
        candidate = find_best_candidate(cont)
        # if candidate is the same as cont, use its inner contents; else use candidate's contents
        if candidate:
            inner_html = ''.join(str(c) for c in candidate.contents)
        else:
            inner_html = ''.join(str(c) for c in cont.contents)

        cur.execute('UPDATE articles SET content = ? WHERE slug = ?', (inner_html, slug))
        if cur.rowcount:
            updated += 1
    conn.commit()
    conn.close()
    print(f'Refined content and updated DB for {updated} articles')

if __name__ == '__main__':
    main()
