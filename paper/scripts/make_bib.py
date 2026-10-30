#!/usr/bin/env python3
"""Build paper/references.bib from the verified research catalog.

Only keys cited in paper/main.tex (and paper/sections/*.tex) are emitted. A key must exist in
paper/research/bibliography.json (verified or metadata-corrected), in the G5 gap-fill sources, or in
the small hand list below (each traceable to a RESEARCH.md claim). Unknown keys and entries flagged
needs_reverification fail the build.

Usage: python3 paper/scripts/make_bib.py [--check]
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
P = os.path.join(ROOT, 'paper')

EXTRA = {
    # RESEARCH.md C1 (claims-audited 2026-10-20).
    'anthropic2024agents': {
        'title': 'Building effective agents', 'authors': 'Erik Schluntz; Barry Zhang', 'year': '2024',
        'venue_or_publisher': 'Anthropic Engineering', 'url': 'https://www.anthropic.com/research/building-effective-agents',
        'type': 'blog'},
    # Supplied by the author (pasted thread, read 2026-10-24); informal practitioner discussion, not a study.
    'reddit2026benchmarkwish': {
        'title': 'What benchmark do you wish someone would build?', 'authors': 'r/AI_Agents',
        'year': '2026', 'venue_or_publisher': 'Reddit discussion thread, r/AI_Agents',
        'url': 'https://www.reddit.com/r/AI_Agents/comments/1wvojcs/', 'type': 'other', 'accessed': '2026-10-24'},
}


# Bibliographic metadata verified against CrossRef / arXiv / publisher pages (research/bib-overrides.json,
# 2026-10-30). Corrections are applied from this hand-checked table, not parsed from notes.
CORRECTIONS = {
    'liu2025aishelljack': {'authors': 'Yue Liu; Yanjie Zhao; Yunbo Lyu; Ting Zhang; Haoyu Wang; David Lo'},
    'maddila2025metaagent': {'authors': 'Chandra Maddila; Adam Tait; others'},
    'tan2026coharden': {'authors': 'Yuhao Tan; Zhibang Yang; Fangkai Yang; Yuan Yao; Yu Kang; Lu Wang; Pu Zhao; Xin Zhang; Xiaoxing Ma; Qingwei Lin; Saravan Rajmohan; Dongmei Zhang'},
    'yang2026deprepair': {'authors': 'Shenghao Yang; Bo Lu; Yaochen Liu; Yu Kang; Qiongfang Zhang; Chetan Bansal; Saravan Rajmohan; Minghua Ma'},
    'perkins2009clearview': {'authors': 'Jeff H. Perkins; Sunghun Kim; Sam Larsen; Saman Amarasinghe; Jonathan Bachrach; Michael Carbin; Carlos Pacheco; Frank Sherwood; Stelios Sidiroglou; Greg Sullivan; Weng-Fai Wong; Yoav Zibin; Michael D. Ernst; Martin Rinard'},
    'chen2021codex': {'authors': 'Mark Chen; Jerry Tworek; Heewoo Jun; others'},
    'hatfielddodds2022schemathesis': {'authors': 'Zac Hatfield-Dodds; Dmitry Dygalo'},
    'tfdv-2019': {'authors': 'Neoklis Polyzotis; Martin Zinkevich; Sudip Roy; Eric Breck; Steven Whang'},
    'huang2017grayfailure': {'authors': 'Peng Huang; Chuanxiong Guo; Lidong Zhou; Jacob R. Lorch; Yingnong Dang; Murali Chintalapati; Randolph Yao'},
    'durieux2016itzal': {'year': '2016'},
    'zhu2026toolmaze': {'title': 'When Tools Fail: Benchmarking Dynamic Replanning and Anomaly Recovery in LLM Agents'},
    'kong2025npm': {'title': 'Toward Better Comprehension of Breaking Changes in the NPM Ecosystem'},
    'agentless': {'title': 'Demystifying LLM-Based Software Engineering Agents'},
    'chen2025swexploit': {'title': 'When Correct Patches Become Vulnerable: Red Teaming LLM-Based Program Repair Agents'},
}
OVERRIDE_FIELDS = ('journal', 'booktitle', 'volume', 'number', 'pages', 'doi', 'publisher', 'eprint', 'archivePrefix', 'year')
# Keep the URL and title we verified the claim against for these (the page changed after access).
KEEP_URL = {'sentry-seer-issue-fix'}


def overrides():
    path = os.path.join(P, 'research', 'bib-overrides.json')
    return json.load(open(path)) if os.path.exists(path) else {}


def tex_escape(s):
    return (s.replace('\\', '\\textbackslash{}').replace('&', '\\&').replace('%', '\\%').replace('$', '\\$')
            .replace('#', '\\#').replace('_', '\\_').replace('{', '\\{').replace('}', '\\}')
            .replace('~', '\\textasciitilde{}').replace('^', '\\textasciicircum{}'))


def authors_bib(a):
    a = a.replace(' et al.', '').replace(', et al', '')
    parts = [x.strip() for x in re.split(r';| and ', a) if x.strip()]
    if parts and parts[-1] == 'others':
        return ' and '.join(tex_escape(x) for x in parts[:-1]) + ' and others'
    if len(parts) == 1 and parts[0].count(',') >= 2:
        parts = [x.strip() for x in parts[0].split(',') if x.strip()]
    return ' and '.join('{' + tex_escape(x) + '}' if ' ' not in x.strip() else tex_escape(x) for x in parts) or '{Anonymous}'


def cited_keys():
    keys = []
    files = [os.path.join(P, 'main.tex')] + sorted(glob.glob(os.path.join(P, 'sections', '*.tex')))
    for f in files:
        if os.path.exists(f):
            for m in re.finditer(r'\\cite[pt]?\*?(?:\[[^\]]*\])?\{([^}]+)\}', open(f).read()):
                keys += [k.strip() for k in m.group(1).split(',')]
    return sorted(set(keys))


def catalog():
    cat = {}
    for x in json.load(open(os.path.join(P, 'research', 'bibliography.json'))):
        cat[x['key']] = x
        for al in x.get('aliases', []) or []:
            cat.setdefault(al, x)
    for x in json.load(open(os.path.join(P, 'research', 'gap-g5-novelty-surfaces.sources.json'))):
        cat.setdefault(x['key'], x)
    cat.update(EXTRA)
    for k, v in overrides().items():
        if isinstance(v, dict) and v.get('new_entry'):
            cat[k] = {'title': v['title'], 'authors': v['author'].replace(' and ', '; '), 'year': v['year'],
                      'venue_or_publisher': v.get('booktitle', ''), 'url': v.get('url', ''), 'type': 'paper'}
    return cat


def clean(v):
    # Research notes such as "(... [verify ...])" are for the catalog, not for the printed reference.
    v = re.sub(r'\s*\([^()]*\[verify[^\]]*\][^()]*\)', '', v or '')
    return re.sub(r'\s*\[verify[^\]]*\]', '', v).strip()


def entry(key, x, ov=None):
    x = {k: clean(v) if isinstance(v, str) else v for k, v in x.items()}
    ov = ov or {}
    x.update(CORRECTIONS.get(key, {}))
    t = x.get('type', 'other')
    venue = x.get('venue_or_publisher', '') or ''
    fields = {
        'title': '{' + tex_escape(x['title']) + '}',
        'author': authors_bib(x.get('authors', '') or x.get('venue_or_publisher', 'Anonymous')),
        'year': x.get('year', '') or 'n.d.',
        'howpublished': tex_escape(venue),
        'url': x.get('url', ''),
        'note': 'Accessed ' + x.get('accessed', '2026-10-21'),
    }
    kind = 'misc'
    if t == 'paper' and x.get('arxiv'):
        fields['howpublished'] = f"arXiv:{x['arxiv']}"
    otype = ov.get('type')
    if otype in ('article', 'inproceedings'):
        kind = otype
        fields.pop('howpublished', None)
    elif otype == 'patent':
        fields['howpublished'] = tex_escape(f"U.S. Patent {ov.get('number', '')}, {ov.get('holder', '')}, issued {ov.get('date', '')}")
    for f in OVERRIDE_FIELDS:
        if ov.get(f) and not (f == 'year' and key in CORRECTIONS and 'year' in CORRECTIONS[key]):
            fields[f] = tex_escape(str(ov[f])) if f not in ('doi', 'eprint', 'pages') else str(ov[f])
    if ov.get('url') and key not in KEEP_URL:
        fields['url'] = ov['url']
    if kind in ('article', 'inproceedings') and fields.get('doi'):
        fields.pop('note', None)
    body = ',\n'.join(f'  {k} = {{{v}}}' if k != 'title' else f'  {k} = {v}' for k, v in fields.items() if v)
    return f'@{kind}{{{key},\n{body}\n}}\n'


def build():
    cat = catalog()
    keys = cited_keys()
    missing = [k for k in keys if k not in cat]
    flagged = [k for k in keys if k in cat and cat[k].get('needs_reverification')]
    if missing or flagged:
        print('make_bib: unknown keys: ' + ', '.join(missing) + ('; needs re-verification: ' + ', '.join(flagged) if flagged else ''))
        sys.exit(1)
    return '% Generated by paper/scripts/make_bib.py from paper/research. Do not edit.\n' + '\n'.join(entry(k, cat[k], overrides().get(k)) for k in keys), keys


def main():
    txt, keys = build()
    out = os.path.join(P, 'references.bib')
    if '--check' in sys.argv:
        ok = os.path.exists(out) and open(out).read() == txt
        print(f'make_bib --check: {"OK" if ok else "MISMATCH"} ({len(keys)} keys)')
        sys.exit(0 if ok else 1)
    open(out, 'w').write(txt)
    print(f'wrote {out} ({len(keys)} keys)')


if __name__ == '__main__':
    main()
