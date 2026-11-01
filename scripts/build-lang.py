#!/usr/bin/env python3
"""게임 번역 빌드: i18n/<lang>.tsv (+ i18n/items/<lang>.tsv) → js/lang/<lang>.js

- i18n/keys.json       : UI 영어 원문 목록 (순서 = TSV 의 번호)
- i18n/item_keys.json  : 아이템 이름·설명 영어 원문 목록
- i18n/<lang>.tsv      : "번호<TAB>번역" 한 줄씩. 줄바꿈은 \\n 으로 적음
- i18n/items/all.tsv   : 아이템 설명 "번호<TAB>ko<TAB>vi…" (열 순서 = LANGS)
- 검사: 모든 번호가 있는지, {n} 같은 자리표시자와 <b>·<a> 태그 개수가 원문과 같은지
사용: python3 scripts/build-lang.py   (모든 언어)   /   python3 scripts/build-lang.py vi th
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
I18N = ROOT / 'i18n'
OUT = ROOT / 'js' / 'lang'
LANGS = ['ko', 'vi', 'id', 'th', 'ms', 'tl', 'km', 'my']


def read_tsv(path, keys):
    rows = {}
    for ln, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        if not line.strip() or line.startswith('#'):
            continue
        idx, _, text = line.partition('\t')
        if not idx.strip().isdigit():
            raise SystemExit(f'{path.name}:{ln}: bad line {line[:60]!r}')
        i = int(idx)
        if i >= len(keys):
            raise SystemExit(f'{path.name}:{ln}: index {i} out of range')
        if i in rows:
            raise SystemExit(f'{path.name}:{ln}: duplicate index {i}')
        rows[i] = text.replace('\\n', '\n').strip()
    return rows


def read_items(lang, item_keys):
    """i18n/items/all.tsv: 번호 + 언어별 열(LANGS 순서). 아이템 설명만 (이름은 영어 고유명)"""
    path = I18N / 'items' / 'all.tsv'
    if not path.exists():
        return {}
    col = LANGS.index(lang) + 1
    rows = {}
    for ln, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        if not line.strip() or line.startswith('#'):
            continue
        cells = line.split('\t')
        if len(cells) != len(LANGS) + 1:
            raise SystemExit(f'all.tsv:{ln}: expected {len(LANGS) + 1} columns, got {len(cells)}')
        i = int(cells[0])
        if i >= len(item_keys):
            raise SystemExit(f'all.tsv:{ln}: index {i} out of range')
        rows[i] = cells[col].strip()
    return rows


def check(lang, keys, rows, label, require_all=True):
    errs = []
    missing = [i for i in range(len(keys)) if i not in rows]
    if missing and require_all:
        errs.append(f'{label}: missing {len(missing)} → {missing[:20]}')
    for i, tr in rows.items():
        src = keys[i]
        if sorted(re.findall(r'\{\w+\}', src)) != sorted(re.findall(r'\{\w+\}', tr)):
            errs.append(f'{label} #{i}: placeholders differ: {src!r} → {tr!r}')
        for tag in ('<b', '<a', '</b>', '</a>'):
            if src.count(tag) != tr.count(tag):
                errs.append(f'{label} #{i}: tag {tag} count differs')
    return errs


def main():
    langs = sys.argv[1:] or LANGS
    keys = json.loads((I18N / 'keys.json').read_text(encoding='utf-8'))
    item_keys = json.loads((I18N / 'item_keys.json').read_text(encoding='utf-8'))
    OUT.mkdir(parents=True, exist_ok=True)
    bad = []
    for lang in langs:
        rows = read_tsv(I18N / f'{lang}.tsv', keys)
        errs = check(lang, keys, rows, lang)
        d = {keys[i]: v for i, v in rows.items() if v}
        n_items = 0
        irows = read_items(lang, item_keys)
        if irows:
            errs += check(lang, item_keys, irows, f'{lang}/items', require_all=False)  # 아이템은 설명만 번역(이름은 영어 고유명)
            for i, v in irows.items():
                if v:
                    d.setdefault(item_keys[i], v)
                    n_items += 1
        if errs:
            bad += errs
            continue
        body = json.dumps(d, ensure_ascii=False, indent=0)
        (OUT / f'{lang}.js').write_text(
            f'// 자동 생성 (scripts/build-lang.py) — 직접 고치지 말고 i18n/{lang}.tsv 를 수정하세요\nexport default {body};\n',
            encoding='utf-8')
        print(f'{lang}: {len(rows)} UI + {n_items} item strings')
    if bad:
        print('\n'.join(bad))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
