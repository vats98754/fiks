#!/usr/bin/env python3
"""Build the arXiv submission: plain-text abstract (numbers substituted from generated/pilot.tex),
metadata, and a source tarball (main.tex + main.bbl + generated/*.tex) that compiles without bibtex.

Usage: python3 paper/scripts/arxiv_package.py   (run after latexmk has produced main.bbl)
"""
import os, re, shutil, subprocess, sys, tarfile, tempfile

P = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(P, 'arxiv')

macros = dict(re.findall(r'\\newcommand\{\\(\w+)\}\{([^}]*)\}', open(os.path.join(P, 'generated', 'pilot.tex')).read()))
tex = open(os.path.join(P, 'main.tex')).read()
abs_tex = tex[tex.index('\\begin{abstract}') + 16:tex.index('\\end{abstract}')]
t = abs_tex.replace('\\fiks{}', 'fiks').replace('\\fiks', 'fiks')
t = re.sub(r'\\(\w+)\{\}', lambda m: macros.get(m.group(1), m.group(0)), t)
t = re.sub(r'\\(\w+)', lambda m: macros.get(m.group(1), m.group(0)), t)
t = t.replace('\\%', '%').replace('\\$', '\x00').replace('pass$^5$', 'pass^5').replace('$p=', 'p=').replace('$', '').replace('\x00', '$')
t = re.sub(r'\\emph\{([^}]*)\}', r'\1', t).replace('~', ' ')
t = ' '.join(t.split())
if '\\' in t or '{' in t:
    sys.exit(f'unconverted LaTeX left in abstract: {t}')
if len(t) > 1920:
    sys.exit(f'abstract is {len(t)} characters; arXiv allows 1920')
title = 'fiks: Turning Silent Tool Failures into Gated Repair Pull Requests for MCP Servers'
os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, 'abstract.txt'), 'w').write(t + '\n')
open(os.path.join(OUT, 'metadata.txt'), 'w').write(
    f"Title: {title}\nAuthors: Anvay Vats (University of Waterloo)\n"
    "Primary category: cs.SE\nCross-lists: cs.AI, cs.LG\n"
    "Comments: Pilot study and pre-registration draft; the confirmatory study has not been run. AI-assisted (see the AI use statement). Code and logs: https://github.com/vats98754/fiks\n"
    f"Abstract ({len(t)} chars): see abstract.txt\n")

bbl = os.path.join(P, 'main.bbl')
if not os.path.exists(bbl):
    sys.exit('main.bbl missing: run latexmk first')
files = ['main.tex', 'main.bbl'] + [os.path.join('generated', f) for f in sorted(os.listdir(os.path.join(P, 'generated'))) if f.endswith('.tex')]
tar = os.path.join(OUT, 'fiks-arxiv-src.tar.gz')
with tarfile.open(tar, 'w:gz') as tf:
    for f in files:
        tf.add(os.path.join(P, f), arcname=f)

# Prove the tarball compiles the way arXiv does it (no bibtex run).
with tempfile.TemporaryDirectory() as d:
    with tarfile.open(tar) as tf:
        tf.extractall(d)
    for _ in range(2):
        r = subprocess.run(['pdflatex', '-interaction=nonstopmode', '-halt-on-error', 'main.tex'], cwd=d,
                           capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit('tarball does not compile:\n' + r.stdout[-2000:])
    log = open(os.path.join(d, 'main.log')).read()
    if re.search(r'undefined (citation|reference)|Citation .* undefined|Reference .* undefined', log):
        sys.exit('tarball compiles with undefined citations or references')
print(f'abstract {len(t)} chars; wrote {OUT}/abstract.txt, metadata.txt, fiks-arxiv-src.tar.gz ({len(files)} files); tarball compiles cleanly')
