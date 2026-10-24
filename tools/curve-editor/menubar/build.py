#!/usr/bin/env python3
"""Build the native menu-bar companion as a standalone macOS app bundle."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import plistlib
import platform
import shutil
import subprocess
import sys
import tempfile
import uuid


APP_NAME = "通用矢量图编辑器"
BUNDLE_ID = "local.redcreen.CurveEditorMenu"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="构建通用矢量图编辑器菜单栏应用")
    parser.add_argument("--output", type=Path, default=Path.home() / "Applications" / f"{APP_NAME}.app")
    parser.add_argument("--manager", type=Path, required=True, help="外部 manager.py 的路径")
    parser.add_argument("--project", type=Path, required=True, help="新建页面的默认项目目录")
    parser.add_argument("--python", dest="python_executable", type=Path, default=Path(sys.executable))
    return parser.parse_args()


def checked_path(path: Path, label: str, *, directory: bool = False) -> Path:
    resolved = path.expanduser().resolve()
    valid = resolved.is_dir() if directory else resolved.is_file()
    if not valid:
        kind = "目录" if directory else "文件"
        raise SystemExit(f"{label}{kind}不存在：{resolved}")
    return resolved


def write_bundle(staging_app: Path, source: Path, manager: Path, project: Path, python: Path) -> None:
    contents = staging_app / "Contents"
    macos = contents / "MacOS"
    resources = contents / "Resources"
    macos.mkdir(parents=True)
    resources.mkdir()

    executable = macos / "CurveEditorMenu"
    subprocess.run(
        [
            "xcrun", "swiftc", "-parse-as-library", "-O", "-target",
            f"{platform.machine()}-apple-macosx12.0", str(source), str(source.with_name('BrowserTabs.swift')),
            "-o", str(executable), "-framework", "AppKit",
        ],
        check=True,
    )
    executable.chmod(0o755)

    info = {
        "CFBundleDevelopmentRegion": "zh_CN",
        "CFBundleDisplayName": APP_NAME,
        "CFBundleExecutable": executable.name,
        "CFBundleIdentifier": BUNDLE_ID,
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": APP_NAME,
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": "1.0",
        "CFBundleVersion": "1",
        "LSMinimumSystemVersion": "12.0",
        "LSUIElement": True,
        "NSHighResolutionCapable": True,
        "NSAppleEventsUsageDescription": "查找并切换已打开的本机编辑器标签页，避免重复打开页面。",
    }
    with (contents / "Info.plist").open("wb") as file:
        plistlib.dump(info, file, sort_keys=True)

    config = {"python": str(python), "manager": str(manager), "project": str(project)}
    (resources / "config.json").write_text(
        json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    # swiftc signs its executable before bundle resources exist. Sign the
    # complete local bundle after writing them so Finder can validate it.
    subprocess.run(["codesign", "--force", "--sign", "-", str(staging_app)], check=True)


def install_bundle(staging_app: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    backup = output.with_name(f".{output.name}.backup-{uuid.uuid4().hex}")
    had_existing = output.exists()
    if had_existing:
        output.rename(backup)
    try:
        staging_app.rename(output)
    except BaseException:
        if had_existing and backup.exists():
            backup.rename(output)
        raise
    if backup.exists():
        shutil.rmtree(backup)


def main() -> int:
    args = parse_args()
    source = Path(__file__).with_name("EditorMenu.swift").resolve()
    manager = checked_path(args.manager, "管理程序")
    project = checked_path(args.project, "项目", directory=True)
    python = checked_path(args.python_executable, "Python")
    output = args.output.expanduser().resolve()

    with tempfile.TemporaryDirectory(prefix="curve-editor-menubar-") as temporary:
        staging_app = Path(temporary) / f"{APP_NAME}.app"
        write_bundle(staging_app, source, manager, project, python)
        install_bundle(staging_app, output)

    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
