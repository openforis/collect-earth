#!/usr/bin/env python3
"""
Keeps the updaters small: they carry only the libraries and resources that differ from the release every
installation is known to have, the baseline.

Every installation that checks the update manifest of a Java version was installed or updated by one of its
releases: by the first one (2.0.0 for Java 21), whose updater carries everything, or by a later installer. The
updaters never delete files, so an installation has all the files of the release it was installed with, and an
updater only needs what is new or has changed since the files every release shipped: those of the first release
that each later one shipped too, unchanged. The baseline is those, kept so by pruning it after each release. The
libraries are most of an updater (107 MB of jars that rarely change), and the demo survey in resources another 8 MB.

    # after releasing the baseline (2.0.0), from the release checkout, then commit the file:
    python utils/updater_payload.py record --libs collect-earth-app/target/earth-libs \
        --resources collect-earth-app/resources --baseline collect-earth-installer/src/main/updater-baseline.txt \
        --version 2.0.0

    # after releasing each of the next ones (2.0.1, 2.1.0...), the same way, then commit the file:
    python utils/updater_payload.py prune --libs ... --resources ... --baseline ... --version 2.0.1

    # what the assembly profile runs before InstallBuilder:
    python utils/updater_payload.py build --libs ... --resources ... --baseline ... --out target/updater-payload \
        --jar collect-earth-app/target/CollectEarth.jar \
        --previous-manifest false --updater-project collect-earth-installer/src/main/resources/CollectEarthUpdater.xml

With no baseline file, build copies everything: the updater of the baseline release itself is a full one, and
deleting the file (for the next Java move, 3.0) makes the next updater full again.

prune drops from the baseline the files the release does not ship, or ships changed. Kept, a library that left
the application in a release and came back later identical would be taken for one every installation has,
although those installed by that release never had it: they would miss it from the class path. prune never adds
files: the installations that skipped the release do not have its new ones. The baseline records the release it
was recorded or last pruned for, and build stops unless that is the release before the one built: a prune missed
would otherwise go unnoticed until a library comes back.

build also stops when a library of CollectEarth.jar's Class-Path is missing from the libraries (an app module not
built yet, or half copied), and when the updater is published to the previous Java's manifest too (2.0, which moves
the installations from Java 11) but would not carry everything: a baseline, or no JRE.
"""
import argparse
import hashlib
import os
import posixpath
import shutil
import subprocess
import sys
import zipfile

CATEGORIES = ("earth-libs", "resources")


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def files(args):
    """{"<category>/<relative path>": absolute path} of the libraries and the resources."""
    found = {}
    for category, root in zip(CATEGORIES, (args.libs, args.resources)):
        if not os.path.isdir(root):
            sys.exit(f"No folder {root}")
        for folder, dirs, names in os.walk(root):
            dirs.sort()
            for name in sorted(names):
                path = os.path.join(folder, name)
                found[category + "/" + os.path.relpath(path, root).replace(os.sep, "/")] = path
    return found


RELEASE = "#release "


def read_baseline(path):
    """({name: sha256}, the release it was recorded or last pruned for, None for a file from before that was kept)."""
    baseline = {}
    release = None
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith(RELEASE):
                release = line[len(RELEASE):].strip()
            elif line and not line.startswith("#"):
                digest, name = line.split(" ", 1)
                baseline[name] = digest
    return baseline, release


def write_baseline(path, digests, release):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("# Files every installation of this Java version has: see utils/updater_payload.py\n")
        f.write(f"{RELEASE}{release}\n")
        for name, digest in sorted(digests.items()):
            f.write(f"{digest} {name}\n")


def record(args):
    current = files(args)
    write_baseline(args.baseline, {name: sha256(path) for name, path in current.items()}, args.version)
    print(f"Recorded {len(current)} files of {args.version} in {args.baseline}")


def prune(args):
    """Keeps in the baseline only the files this release ships unchanged; it never adds any."""
    if not os.path.isfile(args.baseline):
        sys.exit(f"No baseline at {args.baseline}: record the first release of this Java version first")
    current = files(args)
    baseline, _ = read_baseline(args.baseline)
    kept = {name: digest for name, digest in baseline.items()
            if name in current and sha256(current[name]) == digest}
    write_baseline(args.baseline, kept, args.version)
    print(f"Kept {len(kept)} of {len(baseline)} files in {args.baseline}, pruned for {args.version}")
    for name in sorted(set(baseline) - set(kept)):
        print(f"  {'changed' if name in current else 'gone   '} {name}")


def class_path(jar):
    """The entries of the Class-Path in the manifest of a jar."""
    with zipfile.ZipFile(jar) as z:
        manifest = z.read("META-INF/MANIFEST.MF").decode("utf-8")
    # A manifest line goes on in the next one that starts with a space
    manifest = manifest.replace("\r\n", "\n").replace("\n ", "")
    for line in manifest.split("\n"):
        if line.startswith("Class-Path:"):
            return line.split(":", 1)[1].split()
    return []


def check_libs(jar, libs):
    """Every library the jar's Class-Path names is in the libraries: none were left out of the installers."""
    entries = class_path(jar)
    if not entries:
        sys.exit(f"No Class-Path in the manifest of {jar}")
    missing = [e for e in entries if not os.path.isfile(os.path.join(libs, posixpath.basename(e)))]
    if missing:
        sys.exit(f"{len(missing)} of the {len(entries)} libraries of {jar}'s Class-Path are not in {libs}, e.g."
                 f" {missing[:5]}: build collect-earth-app first")


TAG = "collect-earth-"


def previous_release():
    """The release before the one built, from the tags: the last one before HEAD, which in the checkout of a release
    is its own tag (release:perform builds the tagged commit)."""
    try:
        tag = subprocess.run(["git", "describe", "--tags", "--abbrev=0", "--match", TAG + "*", "HEAD^"],
                             cwd=os.path.dirname(os.path.abspath(__file__)), capture_output=True, text=True,
                             check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as e:
        sys.exit(f"Cannot tell the release before this one from the git tags ({e}): pass --previous-version")
    return tag[len(TAG):]


def check_previous_manifest(args, baseline):
    """Offered to the installations on the previous Java too, the updater must carry everything, the JRE too."""
    if baseline is not None:
        sys.exit(f"{args.baseline} exists, but this updater is published to the previous Java's manifest too"
                 " (autoupdate.previous-manifest.upload): its installations have none of the baseline. Set the"
                 " property to false, as from the release after the move")
    with open(args.updater_project, encoding="utf-8") as f:
        if "<file>java.xml</file>" not in f.read():
            sys.exit(f"{args.updater_project} does not include java.xml, but this updater is published to the"
                     " previous Java's manifest too (autoupdate.previous-manifest.upload): it must carry the JRE")


def build(args):
    check_libs(args.jar, args.libs)
    current = files(args)
    baseline = None
    if os.path.isfile(args.baseline):
        baseline, release = read_baseline(args.baseline)
        previous = args.previous_version or previous_release()
        if release != previous:
            sys.exit(f"{args.baseline} was recorded or last pruned for {release}, not for {previous},"
                     " the release before this one: prune it from the checkout of that release first (see"
                     " utils/updater_payload.py)")
    if args.previous_manifest:
        check_previous_manifest(args, baseline)
    if os.path.isdir(args.out):
        shutil.rmtree(args.out)
    for category in CATEGORIES:
        # InstallBuilder packs these folders even when nothing in them changed
        os.makedirs(os.path.join(args.out, category))
    copied = size = 0
    for name, path in sorted(current.items()):
        if baseline is not None and baseline.get(name) == sha256(path):
            continue
        target = os.path.join(args.out, *name.split("/"))
        os.makedirs(os.path.dirname(target), exist_ok=True)
        shutil.copy2(path, target)
        copied += 1
        size += os.path.getsize(path)
        if baseline is not None:
            print(f"  {'changed' if name in baseline else 'new    '} {name}")
    if baseline is None:
        print(f"No baseline at {args.baseline}: the updater carries all {copied} files ({size / 1e6:.1f} MB)")
        return
    print(f"The updater carries {copied} of {len(current)} files ({size / 1e6:.1f} MB), the others are those of the baseline")
    gone = sorted(set(baseline) - set(current))
    if gone:
        # Mostly the old versions of libraries that were upgraded, which is fine
        print(f"Baseline files the application does not have anymore (prune {args.baseline} after each release, or"
              f" should one of them come back identical, the installations made without it will not get it):")
        for name in gone:
            print(f"  {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("record", "prune", "build"))
    parser.add_argument("--libs", required=True, help="the earth-libs folder of the build")
    parser.add_argument("--resources", required=True, help="the resources folder of collect-earth-app")
    parser.add_argument("--baseline", required=True, help="the baseline file")
    parser.add_argument("--version", help="record, prune: the release the libraries and resources are of")
    parser.add_argument("--out", help="build: the folder the updater packs")
    parser.add_argument("--jar", help="build: CollectEarth.jar, whose Class-Path names the libraries")
    parser.add_argument("--previous-version", help="build: the release before the one built (default: from the tags)")
    parser.add_argument("--previous-manifest", choices=("true", "false"), default="false",
                        help="build: true when the updater is published to the previous Java's manifest too")
    parser.add_argument("--updater-project", help="build: the InstallBuilder project of the updater")
    args = parser.parse_args()
    args.previous_manifest = args.previous_manifest == "true"
    if args.command in ("record", "prune"):
        if not args.version:
            parser.error(f"{args.command} needs --version")
        (record if args.command == "record" else prune)(args)
    else:
        for option in ("out", "jar"):
            if not getattr(args, option):
                parser.error(f"build needs --{option.replace('_', '-')}")
        if args.previous_manifest and not args.updater_project:
            parser.error("build needs --updater-project with --previous-manifest true")
        build(args)


if __name__ == "__main__":
    main()
