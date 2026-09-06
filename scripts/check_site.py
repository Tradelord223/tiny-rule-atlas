#!/usr/bin/env python3
"""Check static pages for missing local assets, broken anchors, and duplicate IDs."""

from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


class Page(HTMLParser):
    def __init__(self, path: Path):
        super().__init__()
        self.path = path
        self.ids = []
        self.references = []
        self.errors = []
        self.headings = 0

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if attributes.get("id"):
            self.ids.append(attributes["id"])
        if tag == "h1":
            self.headings += 1
        if tag == "img" and "alt" not in attributes:
            self.errors.append("image has no alt attribute")
        for attribute in ("href", "src"):
            value = attributes.get(attribute)
            if value:
                self.references.append(value)


def main():
    pages = {}
    problems = []
    for path in sorted(ROOT.glob("*.html")):
        page = Page(path)
        page.feed(path.read_text(encoding="utf-8"))
        pages[path] = page
        if page.headings != 1:
            page.errors.append(f"expected one h1, found {page.headings}")
        duplicates = [key for key, count in Counter(page.ids).items() if count > 1]
        page.errors.extend(f"duplicate id: {key}" for key in duplicates)
    references = 0
    for path, page in pages.items():
        for reference in page.references:
            url = urlsplit(reference)
            if url.scheme or url.netloc:
                continue
            target = (path.parent / unquote(url.path)).resolve() if url.path else path
            if not target.is_relative_to(ROOT):
                page.errors.append(f"reference leaves site root: {reference}")
                continue
            if target.is_dir():
                target /= "index.html"
            if not target.is_file():
                page.errors.append(f"missing local target: {reference}")
                continue
            references += 1
            # Parameter fragments configure the simulators; plain fragments name elements.
            if target in pages and url.fragment and "=" not in url.fragment:
                if unquote(url.fragment) not in pages[target].ids:
                    page.errors.append(f"missing section anchor: {reference}")
        problems.extend(f"{path.name}: {error}" for error in page.errors)
    if problems:
        raise SystemExit("Static site validation failed:\n" + "\n".join(problems))
    print(f"Verified {len(pages)} pages and {references} local references; no missing assets, anchors, or duplicate IDs.")


if __name__ == "__main__":
    main()
