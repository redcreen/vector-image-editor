#!/usr/bin/env python3
"""Install a self-contained personal skill from the maintained project source."""
import argparse
import os
from pathlib import Path
import shutil
import native_image_clipboard


def main():
    parser = argparse.ArgumentParser()
    default = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'skills'
    parser.add_argument('--skills-dir', type=Path, default=default)
    parser.add_argument('--menubar-only', action='store_true', help='仅发布状态栏源码，保留当前画布服务资源')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    target = args.skills_dir.expanduser().resolve() / 'vector-editor'
    template = root / 'skill'
    if target.exists() and not (target / 'SKILL.md').is_file():
        raise SystemExit('目标目录已存在但不是 Skill，未覆盖：' + str(target))
    if args.menubar_only:
        if not (target / 'assets/editor/manager.py').is_file():
            raise SystemExit('请先完整安装通用矢量图编辑器 Skill')
        shutil.copytree(root / 'menubar', target / 'assets/editor/menubar', dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        print('已更新状态栏源码：' + str(target / 'assets/editor/menubar'))
        return
    # Finish compilation before changing the installed package.
    clipboard_helper = native_image_clipboard.build_helper(root)
    for source in template.rglob('*'):
        if source.is_file() and '__pycache__' not in source.parts:
            dest = target / source.relative_to(template)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, dest)
    app = target / 'assets/editor'
    app.mkdir(parents=True, exist_ok=True)
    for name in ('index.html', 'style.css', 'app.js', 'geometry.js', 'symmetry.js', 'fairing.js', 'simplify.js', 'walk.js', 'bend.js', 'notches.js', 'fitting-range.js', 'fitting.js', 'offset.js', 'offset-fit.js', 'interactions.js', 'dimension.js', 'text.js', 'layers.js', 'tracing.js', 'editor-session.js', 'server.py', 'editor_registry.py', 'manager.py', 'vector-files.js', 'image-metadata.js', 'image-region.js', 'printing.js', 'vector_io.py', 'vector_ai.py', 'vector_dxf.py', 'vector_plt.py', 'vector_text.py', 'vector_dimension.py'):
        shutil.copy2(root / name, app / name)
    shutil.copytree(root / 'examples', app / 'examples', dirs_exist_ok=True)
    shutil.copytree(root / 'vendor', app / 'vendor', dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    shutil.copytree(root / 'menubar', app / 'menubar', dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    for name in ('native_image_clipboard.py', 'native-image-clipboard.swift'):
        shutil.copy2(root / name, app / name)
    if clipboard_helper:
        shutil.copy2(clipboard_helper, app / 'native-image-clipboard')
    print('已安装通用矢量图编辑器 Skill：' + str(target))


if __name__ == '__main__':
    main()
