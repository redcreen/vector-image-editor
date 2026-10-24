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
    parser.add_argument('--name', help='页面及状态栏中的名称')
    parser.add_argument('--blank', action='store_true', help='新工作区使用空白画板')
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument('--session', help='独立会话 ID；默认使用当前 Codex 会话')
    scope.add_argument('--shared', help='共享工作区名称；default 访问旧版项目存档')
    args = parser.parse_args()
    server = Path(__file__).resolve().parents[1] / 'assets/editor/server.py'
    if not server.is_file():
        parser.error('编辑器文件缺失，请重新安装完整 Skill')
    command = [sys.executable, str(server), '--project', str(args.project), '--port', args.port]
    if args.open:
        command.append('--open')
    if args.name is not None:
        command.extend(['--name', args.name])
    if args.blank:
        command.append('--blank')
    if args.session is not None:
        command.extend(['--session', args.session])
    if args.shared is not None:
        command.extend(['--shared', args.shared])
    os.execv(sys.executable, command)


if __name__ == '__main__':
    main()
