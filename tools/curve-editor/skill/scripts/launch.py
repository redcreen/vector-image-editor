#!/usr/bin/env python3
"""Launch the bundled editor with an explicit project-owned save directory."""
import argparse
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser(description='在当前项目启动通用矢量图编辑器')
    parser.add_argument('--project', type=Path, required=True)
    parser.add_argument('--port', default='auto')
    parser.add_argument('--open', action='store_true')
    args = parser.parse_args()
    server = Path(__file__).resolve().parents[1] / 'assets/editor/server.py'
    if not server.is_file():
        parser.error('编辑器文件缺失，请重新安装完整 Skill')
    command = [sys.executable, str(server), '--project', str(args.project), '--port', args.port]
    if args.open:
        command.append('--open')
    os.execv(sys.executable, command)


if __name__ == '__main__':
    main()
