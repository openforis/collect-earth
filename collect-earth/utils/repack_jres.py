#!/usr/bin/env python3
"""
Downloads the Eclipse Temurin JREs the installers bundle, repacks them in the layout
collect-earth-installer expects and installs them in the local Maven repository as
net.java.openjdk:jre:<version>:zip:<classifier>.

No repository serves these artifacts: the installer build only finds them because this
script put them in the local repository. The assembly profile of collect-earth-installer
runs it at the initialize phase for the jre.version of its pom, with --if-missing, so a
machine that has never built the installers gets them on its first build and the others
lose nothing (-Djre.ensure.skip=true turns that off).

By hand, to move to another JRE:

    python utils/repack_jres.py              # newest Temurin 21 that is out on every platform
    python utils/repack_jres.py --feature 25
    python utils/repack_jres.py --release jdk-21.0.12.1+1

Then set jre.version in collect-earth-installer/pom.xml to the version it prints.

Layout of each zip (see src/main/resources/java.xml):
    jre<version>-<classifier>/java-<os>/{bin,conf,legal,lib,release,...}
The macOS archive's Contents/Home is what goes into java-osx.
"""
import argparse
import hashlib
import json
import os
import posixpath
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile

API = "https://api.adoptium.net/v3"
# Adoptium answers 403 to Python's default User-Agent
HEADERS = {"User-Agent": "collect-earth-installer-repack-jres/1.0"}

# Maven classifier -> (Adoptium os, folder inside the zip). x64 only, as the installers are.
PLATFORMS = {
    "windows-x64": ("windows", "java-windows"),
    "linux-x64": ("linux", "java-linux-x64"),
    "osx": ("mac", "java-osx"),
}


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS)) as response:
        return json.load(response)


QUERY = {"image_type": "jre", "architecture": "x64", "heap_size": "normal", "jvm_impl": "hotspot", "vendor": "eclipse"}


def jre_packages(binaries):
    """Adoptium os -> package, for the x64 JREs among the binaries of a release."""
    return {b["os"]: b["package"] for b in binaries if b["architecture"] == "x64" and b["image_type"] == "jre"}


def find_release(feature, release):
    """The release name and its package for each platform: the one asked for, or the newest one that has them all.

    The platforms of a release do not come out together (Windows can lag days behind), and installers on different
    builds would report different versions, so a release with a platform missing is passed over."""
    wanted = {os_name for os_name, _ in PLATFORMS.values()}
    if release:
        query = urllib.parse.urlencode(QUERY)
        data = get_json(f"{API}/assets/release_name/eclipse/{urllib.parse.quote(release)}?{query}")
        packages = jre_packages(data["binaries"])
        missing = wanted - packages.keys()
        if missing:
            sys.exit(f"{release} has no x64 JRE for {', '.join(sorted(missing))}")
        return data["release_name"], packages
    query = urllib.parse.urlencode(dict(QUERY, page_size=10, sort_order="DESC"))
    for data in get_json(f"{API}/assets/feature_releases/{feature}/ga?{query}"):
        packages = jre_packages(data["binaries"])
        missing = wanted - packages.keys()
        if not missing:
            return data["release_name"], packages
        print(f"{data['release_name']}: skipped, no x64 JRE yet for {', '.join(sorted(missing))}")
    sys.exit(f"No recent Temurin {feature} release has an x64 JRE for every platform")


def download(package, folder):
    path = os.path.join(folder, package["name"])
    print(f"  downloading {package['link']}")
    digest = hashlib.sha256()
    with urllib.request.urlopen(urllib.request.Request(package["link"], headers=HEADERS)) as response, open(path, "wb") as out:
        for chunk in iter(lambda: response.read(1 << 20), b""):
            digest.update(chunk)
            out.write(chunk)
    if digest.hexdigest() != package["checksum"]:
        sys.exit(f"Checksum mismatch for {package['name']}: {digest.hexdigest()} != {package['checksum']}")
    return path


def read_archive(archive):
    """The files of a JRE archive as {path in the archive: (unix mode, content, zip date_time)}.

    Read in memory, never extracted: the Linux and macOS archives hold symbolic links (legal/*), which Windows will not
    create without administrator rights. A link is stored as the file it points to, as the installers copy files."""
    files = {}
    if archive.endswith(".zip"):
        with zipfile.ZipFile(archive) as z:
            for info in z.infolist():
                if not info.is_dir():
                    files[info.filename] = ((info.external_attr >> 16) & 0o777, z.read(info), info.date_time)
        return files
    links = {}
    with tarfile.open(archive) as t:
        for member in t.getmembers():
            name = posixpath.normpath(member.name)
            if member.isfile():
                # a zip cannot date a file before 1980
                date_time = max(time.localtime(member.mtime)[:6], (1980, 1, 1, 0, 0, 0))
                files[name] = (member.mode & 0o777, t.extractfile(member).read(), date_time)
            elif member.issym():
                links[name] = posixpath.normpath(posixpath.join(posixpath.dirname(name), member.linkname))
            elif member.islnk():
                links[name] = posixpath.normpath(member.linkname)
    for name, target in links.items():
        for _ in range(10):  # a link to a link
            if target not in links:
                break
            target = links[target]
        if target in files:
            files[name] = files[target]
        else:
            print(f"  left out {name}: a link to {target}, which is not a file of the archive")
    return files


def jre_home(files, archive):
    """The folder of the archive that holds bin/, lib/, release: under the one top folder, Contents/Home on macOS."""
    roots = {name.split("/", 1)[0] for name in files}
    if len(roots) != 1:
        sys.exit(f"Expected one top folder in {archive}, found {sorted(roots)}")
    root = roots.pop() + "/"
    return root + "Contents/Home/" if any(name.startswith(root + "Contents/Home/") for name in files) else root


def repack(archive, version, classifier, java_folder, target):
    files = read_archive(archive)
    home = jre_home(files, archive)
    prefix = f"jre{version}-{classifier}/{java_folder}/"
    folders = set()
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for name in sorted(n for n in files if n.startswith(home)):
            relative = name[len(home):]
            # Folder entries first, as in the zips made by hand before
            parts = relative.split("/")[:-1]
            for i in range(len(parts) + 1):
                folder = prefix + "".join(p + "/" for p in parts[:i])
                if folder not in folders:
                    folders.add(folder)
                    z.writestr(zipfile.ZipInfo(folder), b"")
            mode, content, date_time = files[name]
            # Keep the executable bits (the Windows zip carries none): bin/* and lib/jspawnhelper must run
            if (relative.startswith("bin/") or parts[-1:] == ["lib"] and posixpath.basename(relative) in ("jspawnhelper", "jexec")) \
                    and not relative.endswith(".dll"):
                mode |= 0o755
            # The release's dates, not 1980: an updater that only overwrites older files must take them for new
            info = zipfile.ZipInfo(prefix + relative, date_time)
            info.external_attr = ((mode or 0o644) | stat.S_IFREG) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, content)


def installed_zip(repo, version, classifier):
    return os.path.join(repo, "net", "java", "openjdk", "jre", version, f"jre-{version}-{classifier}.zip")


def install(zip_path, version, classifier, mvn, repo):
    command = [mvn, "-q", "install:install-file", "-DgroupId=net.java.openjdk", "-DartifactId=jre",
               f"-Dversion={version}", f"-Dclassifier={classifier}", "-Dpackaging=zip",
               f"-Dfile={zip_path}", "-DgeneratePom=true"]
    if repo:
        # The repository the build that runs this reads from, which settings.xml may have moved
        command.append(f"-Dmaven.repo.local={repo}")
    subprocess.run(command, check=True, shell=(os.name == "nt"))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--feature", type=int, default=21, help="Java feature release, newest build on every platform (default 21)")
    parser.add_argument("--release", help="exact Temurin release name, e.g. jdk-21.0.12.1+1")
    parser.add_argument("--out", help="folder to keep the repacked zips in (default: a temporary one)")
    parser.add_argument("--no-install", action="store_true", help="only build the zips")
    parser.add_argument("--mvn", default="mvn", help="Maven executable")
    parser.add_argument("--repo", help="local Maven repository (default: the one mvn uses)")
    parser.add_argument("--if-missing", action="store_true",
                        help="with --release and --repo: do nothing when its zips are already installed there")
    args = parser.parse_args()
    if args.no_install and not args.out:
        parser.error("--no-install needs --out, or the zips are deleted with the downloads")

    classifiers = list(PLATFORMS)
    if args.if_missing:
        if not (args.release and args.repo):
            parser.error("--if-missing needs --release and --repo")
        version = args.release[len("jdk-"):]
        classifiers = [c for c in PLATFORMS if not os.path.isfile(installed_zip(args.repo, version, c))]
        if not classifiers:
            print(f"Temurin JREs {version} already in {args.repo}")
            return
        print(f"Temurin JREs {version} not in {args.repo} ({', '.join(classifiers)}): downloading them")

    release_name, packages = find_release(args.feature, args.release)
    version = release_name[len("jdk-"):]
    work = tempfile.mkdtemp(prefix="collect-earth-jre-")
    out = args.out or work
    os.makedirs(out, exist_ok=True)
    try:
        for classifier in classifiers:
            os_name, java_folder = PLATFORMS[classifier]
            print(f"{classifier}: Temurin {version}")
            archive = download(packages[os_name], work)
            target = os.path.join(out, f"jre-{version}-{classifier}.zip")
            repack(archive, version, classifier, java_folder, target)
            os.remove(archive)
            print(f"  repacked to {target}")
            if not args.no_install:
                install(target, version, classifier, args.mvn, args.repo)
                print(f"  installed net.java.openjdk:jre:{version}:zip:{classifier}")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    if not args.if_missing:
        print(f"\nSet <jre.version>{version}</jre.version> in collect-earth-installer/pom.xml")


if __name__ == "__main__":
    main()
