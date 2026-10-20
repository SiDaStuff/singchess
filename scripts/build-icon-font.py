"""Rebuild the checked-in icon subset after adding icons (requires fonttools[woff])."""
from pathlib import Path
import re
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parent.parent
source = root / 'node_modules/@fontsource/material-symbols-outlined/files/material-symbols-outlined-latin-400-normal.woff2'
font = TTFont(source)
text = (root / 'index.html').read_text(encoding='utf-8')
for path in (root / 'src').rglob('*'):
    if path.suffix in ('.js', '.css', '.html'):
        text += '\n' + path.read_text(encoding='utf-8')
words = set(re.findall(r'\b[a-z][a-z0-9_]+\b', text))
glyphs = words.intersection(font.getGlyphOrder())
# Keep ligature inputs without retaining every other icon containing a letter.
cmap = font.getBestCmap()
glyphs.update(cmap[ord(ch)] for ch in 'abcdefghijklmnopqrstuvwxyz0123456789_' if ord(ch) in cmap)
options = subset.Options()
options.layout_closure = False
options.flavor = 'woff2'
subsetter = subset.Subsetter(options=options)
subsetter.populate(glyphs=glyphs)
subsetter.subset(font)
target = root / 'src/ui/fonts/chess-icons.woff2'
target.parent.mkdir(parents=True, exist_ok=True)
font.save(target)
license_target = root / 'public/licenses/material-symbols.txt'
license_target.parent.mkdir(parents=True, exist_ok=True)
license_target.write_text((source.parent.parent / 'LICENSE').read_text(encoding='utf-8'), encoding='utf-8')
print(f'{len(glyphs)} glyphs: {source.stat().st_size:,} -> {target.stat().st_size:,} bytes')
