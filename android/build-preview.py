#!/usr/bin/env python3
"""Build an offline preview with official Android SDK tools; no dependency downloads.

Requires Python 3.10+, JDK 17, SDK Platform 36 and Build Tools 36.0.0.
The generated development key must stay outside all deliverables.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

ANDROID_DIR = Path(__file__).resolve().parent
WEB_ROOT = ANDROID_DIR.parent
ASSETS = ("index.html", "src/app.js", "src/model.js", "src/fixtures.js", "src/styles.css", "assets/workstation.svg")
WORK_MARKER = ".ryodev-preview-build"
WORK_MARKER_CONTENT = "RyoDev offline APK builder scratch v1\n"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(*args: object) -> str:
    command = [str(arg) for arg in args]
    result = subprocess.run(command, check=False, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.stdout.strip():
        print(result.stdout.strip())
    result.check_returncode()
    return result.stdout


def executable(directory: Path, name: str) -> Path:
    return directory / (name + (".exe" if os.name == "nt" else ""))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk", type=Path, default=os.environ.get("ANDROID_HOME"), help="Installed official Android SDK root")
    parser.add_argument("--android-jar", type=Path, help="Explicit Platform 36 android.jar, overrides --sdk")
    parser.add_argument("--build-tools", type=Path, help="Explicit Build Tools 36.0.0 directory, overrides --sdk")
    parser.add_argument("--work-dir", type=Path, help="Empty/reusable scratch directory OUTSIDE source; contains development key")
    parser.add_argument("--output", type=Path, required=True, help="Preview APK destination")
    args = parser.parse_args()
    if not args.sdk and (not args.android_jar or not args.build_tools):
        parser.error("Supply --sdk (or ANDROID_HOME), or both --android-jar and --build-tools.")
    platform = (args.android_jar or args.sdk / "platforms/android-36/android.jar").resolve()
    build_tools = (args.build_tools or args.sdk / "build-tools/36.0.0").resolve()
    java_home = os.environ.get("JAVA_HOME")
    java = str(executable(Path(java_home) / "bin", "java")) if java_home else shutil.which("java")
    keytool = str(executable(Path(java_home) / "bin", "keytool")) if java_home else shutil.which("keytool")
    if not java or not keytool:
        parser.error("JDK 17 java and keytool must be available.")
    if not platform.is_file() or not (build_tools / "lib/d8.jar").is_file():
        parser.error("Required official SDK Platform 36 / Build Tools 36.0.0 files are missing.")
    platform_properties = (platform.parent / "source.properties").read_text(encoding="utf-8").replace(" ", "")
    if "AndroidVersion.ApiLevel=36\n" not in platform_properties:
        parser.error("This build is pinned to Android SDK Platform 36.")
    properties = (build_tools / "source.properties").read_text(encoding="utf-8")
    if "Pkg.Revision=36.0.0" not in properties.replace(" ", ""):
        parser.error("This build is pinned to Android Build Tools 36.0.0.")
    output = args.output.resolve()
    if output.suffix.lower() != ".apk":
        parser.error("The output must be an .apk path, not a source file.")
    work = args.work_dir.resolve() if args.work_dir else Path(tempfile.mkdtemp(prefix="ryodev-apk-"))
    if work == WEB_ROOT or WEB_ROOT in work.parents:
        parser.error("The work directory contains a private development key; choose a path outside the project.")
    if work.exists() and not work.is_dir():
        parser.error("The work path must be a directory.")
    marker = work / WORK_MARKER
    if work.exists() and any(work.iterdir()):
        if not marker.is_file() or marker.is_symlink() or marker.read_text(encoding="utf-8") != WORK_MARKER_CONTENT:
            parser.error("Nonempty work directory is not owned by this builder. Choose a new empty directory; nothing was removed.")
    work.mkdir(parents=True, exist_ok=True)
    marker.write_text(WORK_MARKER_CONTENT, encoding="utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    # Only these generated subdirectories are replaced on a repeated build.
    for name in ("assets", "classes", "dex", "test-classes"):
        directory = work / name
        if directory.exists():
            shutil.rmtree(directory)
        directory.mkdir()
    print("Building RyoDev Demo; fixture-only, development-signed, NOT a production release.")
    print("Scratch directory (contains development signing material):", work)
    hashes = {}
    for relative in ASSETS:
        source = WEB_ROOT / relative
        if not source.is_file() or source.is_symlink():
            raise RuntimeError("Missing or symlinked frontend asset: " + relative)
        destination = work / "assets/web" / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        hashes[relative] = sha256(source)

    # JVM tests exercise fail-closed routing, independent of a WebView implementation.
    policy = ANDROID_DIR / "src/dev/ryodev/demo/AssetPolicy.java"
    run(java, "-m", "jdk.compiler/com.sun.tools.javac.Main", "--release", "8", "-d", work / "test-classes",
        policy, ANDROID_DIR / "tests/AssetPolicyTest.java")
    run(java, "-cp", work / "test-classes", "dev.ryodev.demo.AssetPolicyTest")

    aapt2 = executable(build_tools, "aapt2")
    resource_zip = work / "resources.zip"
    run(aapt2, "compile", "--dir", ANDROID_DIR / "res", "-o", resource_zip)
    unsigned = work / "unsigned.apk"
    run(aapt2, "link", "-I", platform, "--manifest", ANDROID_DIR / "AndroidManifest.xml",
        "-A", work / "assets", "-o", unsigned, resource_zip)
    sources = sorted((ANDROID_DIR / "src").rglob("*.java"))
    run(java, "-m", "jdk.compiler/com.sun.tools.javac.Main", "--release", "8",
        "-classpath", platform, "-d", work / "classes", *sources)
    bytecode_jar = work / "classes.jar"
    with zipfile.ZipFile(bytecode_jar, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file in sorted((work / "classes").rglob("*.class")):
            archive.write(file, file.relative_to(work / "classes").as_posix())
    run(java, "-cp", build_tools / "lib/d8.jar", "com.android.tools.r8.D8", "--release", "--min-api", "26",
        "--lib", platform, "--output", work / "dex", bytecode_jar)
    with zipfile.ZipFile(unsigned, "a", compression=zipfile.ZIP_DEFLATED) as archive:
        for dex in sorted((work / "dex").glob("*.dex")):
            archive.write(dex, dex.name)
    aligned = work / "aligned.apk"
    run(executable(build_tools, "zipalign"), "-f", "-p", "4", unsigned, aligned)
    key = work / "ryodev-preview-only.p12"
    if not key.exists():
        run(keytool, "-genkeypair", "-keystore", key, "-storetype", "PKCS12", "-storepass", "android",
            "-keypass", "android", "-alias", "androiddebugkey", "-keyalg", "RSA", "-keysize", "2048",
            "-validity", "3650", "-dname", "CN=Android Debug,O=RyoDev Demo,C=US", "-noprompt")
    signer = build_tools / "lib/apksigner.jar"
    run(java, "-jar", signer, "sign", "--ks", key, "--ks-key-alias", "androiddebugkey",
        "--ks-pass", "pass:android", "--key-pass", "pass:android", "--v4-signing-enabled", "false", "--out", output, aligned)
    signature = run(java, "-jar", signer, "verify", "--verbose", "--print-certs", output)
    run(executable(build_tools, "zipalign"), "-c", "-p", "4", output)
    permissions = run(aapt2, "dump", "permissions", output)
    if "uses-permission" in permissions:
        raise RuntimeError("Unexpected permission in APK: " + permissions)
    badging = run(aapt2, "dump", "badging", output)
    if "application-debuggable" in badging:
        raise RuntimeError("APK unexpectedly enables application debugging")
    with zipfile.ZipFile(output) as archive:
        bundled = {name.removeprefix("assets/web/") for name in archive.namelist() if name.startswith("assets/web/")}
        if bundled != set(ASSETS):
            raise RuntimeError("Unexpected asset set in APK: " + repr(bundled))
        for relative, digest in hashes.items():
            if hashlib.sha256(archive.read("assets/web/" + relative)).hexdigest() != digest:
                raise RuntimeError("APK asset changed: " + relative)
            if sha256(WEB_ROOT / relative) != digest:
                raise RuntimeError("Source changed during build; rebuild from a stable source: " + relative)
    evidence = {
        "artifact": output.name, "sha256": sha256(output), "bytes": output.stat().st_size,
        "package": "dev.ryodev.demo", "version": "0.1-preview", "min_sdk": 26, "target_sdk": 36,
        "build_tools": "36.0.0", "signing": "temporary development identity; not a release key",
        "debuggable": False, "permissions": [], "assets_sha256": hashes,
        "signature_verification": signature.strip(), "badging": badging.strip(),
        "device_tested": False, "limitations": "Android install, WebView rendering, system bars, Back, TalkBack and airplane-mode launch require device validation."
    }
    output.with_suffix(".build-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print("Built and statically verified:", output)
    print("SHA-256:", evidence["sha256"])
    print("Android device/emulator execution has NOT been verified.")


if __name__ == "__main__":
    main()
