import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PAGES = [
    ROOT / 'index.html',
    ROOT / 'contact.html',
    ROOT / 'team.html',
    ROOT / 'Research' / 'index.html',
    ROOT / 'Research' / 'algorithmic-abdication.html',
    ROOT / 'Research' / 'algorithmic-radicalization.html',
    ROOT / 'Research' / 'epistemic-passivity.html',
    ROOT / 'Research' / 'intellectual-abdication-effect-of-ai.html',
    ROOT / 'legals' / 'privacy.html',
    ROOT / 'legals' / 'terms.html',
    ROOT / 'legals' / 'AI-policy.html',
]

HEADER_START = '<!-- SHARED_HEADER_START -->'
HEADER_END = '<!-- SHARED_HEADER_END -->'
FOOTER_START = '<!-- SHARED_FOOTER_START -->'
FOOTER_END = '<!-- SHARED_FOOTER_END -->'

HEADER_BLOCK_PATTERN = re.compile(
    r'<div data-site-header></div>\s*<noscript>.*?</noscript>|'
    r'<!-- SHARED_HEADER_START -->.*?<!-- SHARED_HEADER_END -->',
    re.S,
)
FOOTER_BLOCK_PATTERN = re.compile(
    r'<div data-site-footer></div>\s*<noscript>.*?</noscript>|'
    r'<!-- SHARED_FOOTER_START -->.*?<!-- SHARED_FOOTER_END -->',
    re.S,
)

def render_template(name: str, root_prefix: str) -> str:
    template = (ROOT / 'templates' / f'{name}.html').read_text(encoding='utf-8')
    return template.replace('{{root}}', root_prefix)

def replace_block(pattern: re.Pattern[str], text: str, replacement: str, page: Path, label: str) -> str:
    updated, count = pattern.subn(replacement, text, count=1)
    if count != 1:
        raise RuntimeError(f'Expected one {label} block in {page}, found {count}')
    return updated

def main() -> None:
    for page in PAGES:
        text = page.read_text(encoding='utf-8')
        root_prefix = '.' if page.parent == ROOT else '..'

        header = f'{HEADER_START}\n{render_template("header", root_prefix)}\n{HEADER_END}'
        footer = f'{FOOTER_START}\n{render_template("footer", root_prefix)}\n{FOOTER_END}'

        text = replace_block(HEADER_BLOCK_PATTERN, text, header, page, 'header')
        text = replace_block(FOOTER_BLOCK_PATTERN, text, footer, page, 'footer')
        text = text.replace(' data-root-prefix="."', '')
        text = text.replace(' data-root-prefix=".."', '')

        if not text.endswith('\n'):
            text += '\n'

        page.write_text(text, encoding='utf-8')

if __name__ == '__main__':
    main()
