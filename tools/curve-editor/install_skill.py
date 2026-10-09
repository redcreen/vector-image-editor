#!/usr/bin/env python3
"""Install a self-contained personal skill from the maintained project source."""
import argparse
import os
from pathlib import Path
import shutil


def main():
    parser = argparse.ArgumentParser()
    default = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'skills'
    parser.add_argument('--skills-dir', type=Path, default=default)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    target = args.skills_dir.expanduser().resolve() / 'vector-editor'
    template = root / 'skill'
    if target.exists() and not (target / 'SKILL.md').is_file():
        raise SystemExit('目标目录已存在但不是 Skill，未覆盖：' + str(target))
    for source in template.rglob('*'):
        if source.is_file() and '__pycache__' not in source.parts:
            dest = target / source.relative_to(template)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, dest)
    app = target / 'assets/editor'
    app.mkdir(parents=True, exist_ok=True)
    for name in ('index.html', 'style.css', 'app.js', 'geometry.js', 'offset.js', 'interactions.js', 'layers.js', 'tracing.js', 'server.py'):
        shutil.copy2(root / name, app / name)
    shutil.copytree(root / 'examples', app / 'examples', dirs_exist_ok=True)
    shutil.copytree(root / 'vendor', app / 'vendor', dirs_exist_ok=True)
    print('已安装通用矢量图编辑器 Skill：' + str(target))


if __name__ == '__main__':
    main()
