#!/usr/bin/env python3
"""Build and open the local macOS menu-bar companion from this installed skill."""
import argparse
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description='启动通用矢量图编辑器状态栏')
    parser.add_argument('--project', type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('状态栏工具需要 macOS')
    editor = Path(__file__).resolve().parents[1] / 'assets/editor'
    app = Path.home() / 'Applications/通用矢量图编辑器.app'
    subprocess.run([sys.executable, str(editor / 'menubar/build.py'), '--output', str(app),
                    '--manager', str(editor / 'manager.py'), '--project', str(args.project)], check=True)
    subprocess.run(['open', str(app)], check=True)


if __name__ == '__main__':
    main()
