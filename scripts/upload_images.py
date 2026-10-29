#!/usr/bin/env python3
"""Upload base64 images from index.html to Cloudinary and replace with CDN URLs."""

import re
import sys
import json
import time
import requests

HTML_FILE = '/home/user/Nstore_ERP/index.html'
CLOUD     = 'dwbmwxm2l'
PRESET    = 'crm_upload'
UPLOAD_URL = f'https://api.cloudinary.com/v1_1/{CLOUD}/image/upload'

def read_html():
    with open(HTML_FILE, 'r', encoding='utf-8') as f:
        return f.read()

def write_html(content):
    with open(HTML_FILE, 'w', encoding='utf-8') as f:
        f.write(content)

def upload_image(name, data_uri):
    """Upload a data URI to Cloudinary. Returns secure_url or None."""
    public_id = 'nstore/' + name.lower().replace('_img', '').replace('_', '-')
    try:
        resp = requests.post(UPLOAD_URL, data={
            'file': data_uri,
            'upload_preset': PRESET,
            'public_id': public_id,
        }, timeout=30)
        if resp.status_code == 200:
            url = resp.json().get('secure_url', '')
            return url
        else:
            print(f'  ERROR {resp.status_code}: {resp.text[:200]}', flush=True)
            return None
    except Exception as e:
        print(f'  EXCEPTION: {e}', flush=True)
        return None

def main():
    html = read_html()

    # Find all image constants: const NAME = 'data:image/...';
    pattern = re.compile(r"^(const (\w+_IMG)) = '(data:image/[^']+)';", re.MULTILINE)
    matches = list(pattern.finditer(html))
    print(f'Found {len(matches)} image constants\n', flush=True)

    replacements = {}  # const_decl -> new_line

    for i, m in enumerate(matches, 1):
        full_match = m.group(0)
        decl       = m.group(1)   # e.g. "const LACTEL_IMG"
        name       = m.group(2)   # e.g. "LACTEL_IMG"
        data_uri   = m.group(3)   # data:image/jpeg;base64,...

        img_type = 'jpeg' if 'jpeg' in data_uri[:30] else 'png' if 'png' in data_uri[:30] else 'webp'
        size_kb = len(data_uri) * 3 // 4 // 1024
        print(f'[{i:02d}/{len(matches)}] {name} ({size_kb}KB) ... ', end='', flush=True)

        url = upload_image(name, data_uri)
        if url:
            print(f'OK → {url}', flush=True)
            replacements[full_match] = f"{decl} = '{url}';"
        else:
            print(f'FAILED — keeping base64', flush=True)

        time.sleep(0.2)  # gentle rate limiting

    if not replacements:
        print('\nNo replacements made.', flush=True)
        sys.exit(1)

    # Apply replacements
    new_html = html
    for old, new in replacements.items():
        new_html = new_html.replace(old, new, 1)

    write_html(new_html)
    print(f'\nDone. Replaced {len(replacements)}/{len(matches)} constants.', flush=True)

    # Save mapping for reference
    mapping = {m.group(2): replacements.get(m.group(0), 'FAILED') for m in matches}
    with open('/home/user/Nstore_ERP/scripts/image_urls.json', 'w') as f:
        json.dump(mapping, f, indent=2)
    print('URL mapping saved to scripts/image_urls.json', flush=True)

if __name__ == '__main__':
    main()
