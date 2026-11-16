import json
import sys
from collections import deque
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urldefrag
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler, Request
from urllib.error import HTTPError
from urllib.robotparser import RobotFileParser

DEMO = 'http://127.0.0.1:8765'
ORIGINS = {DEMO, 'https://example.com'}
AGENT = 'BuildSprintCrawlChat'
MAX_BYTES = 256_000

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def origin(url):
    parts = urlsplit(url)
    return f'{parts.scheme}://{parts.netloc}'

def fetch(url):
    if origin(url) not in ORIGINS:
        raise ValueError('This site is outside the approved crawl scope.')
    opener = build_opener(ProxyHandler({}), NoRedirect())
    with opener.open(Request(url, headers={'User-Agent': AGENT}), timeout=4) as response:
        data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise ValueError('Response exceeded the size limit.')
        return data.decode('utf-8', errors='replace'), response.headers.get_content_type()

class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = []
        self.paragraphs = []
        self.links = []
        self.field = None
        self.buffer = []

    def handle_starttag(self, tag, attrs):
        if tag in ('title', 'p'):
            self.field, self.buffer = tag, []
        if tag == 'a':
            href = dict(attrs).get('href')
            if href:
                self.links.append(href)

    def handle_data(self, data):
        if self.field:
            self.buffer.append(data)

    def handle_endtag(self, tag):
        if tag == self.field:
            value = ' '.join(''.join(self.buffer).split())
            if value:
                (self.title if tag == 'title' else self.paragraphs).append(value[:400])
            self.field = None

def crawl(start, limit):
    base = origin(start)
    if base not in ORIGINS:
        raise ValueError('Use the local demo site or https://example.com.')
    robots = RobotFileParser()
    try:
        data, _ = fetch(base + '/robots.txt')
    except HTTPError as error:
        if error.code not in (404, 410):
            raise
        data = ''
    robots.parse(data.splitlines())
    queue, seen, pages, errors = deque([start]), {start}, [], []
    for _ in range(limit):
        if not queue:
            break
        url = queue.popleft()
        try:
            if not robots.can_fetch(AGENT, url):
                raise ValueError('Blocked by robots.txt.')
            data, kind = fetch(url)
            if kind != 'text/html':
                raise ValueError('Expected an HTML page.')
            page = Page()
            page.feed(data)
            links = list(dict.fromkeys(urldefrag(urljoin(url, href)).url for href in page.links))
            links = [link for link in links if origin(link) == base][:30]
            pages.append({'url': url, 'title': ' '.join(page.title)[:400],
                          'highlights': page.paragraphs[:4], 'links': links})
            for link in links:
                if link not in seen:
                    seen.add(link)
                    queue.append(link)
        except (OSError, ValueError) as error:
            errors.append({'url': url, 'error': str(error)})
            print(str(error), file=sys.stderr)
    return {'status': 'partial' if pages and errors else 'success' if pages else 'failed',
            'startUrl': start, 'pagesVisited': len(pages), 'pages': pages, 'errors': errors}

if __name__ == '__main__':
    try:
        result = crawl(sys.argv[1], int(sys.argv[2]))
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        result = {'status': 'failed', 'pagesVisited': 0, 'pages': [],
                  'errors': [{'error': str(error)}]}
    print(json.dumps(result))
    sys.exit(1 if result['status'] == 'failed' else 0)
