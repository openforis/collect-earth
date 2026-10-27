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
        --resources collect-earth-app/resources --baseline collect-earth-installer/src/main/updater-baseline.txt

    # after releasing each of the next ones (2.0.1, 2.1.0...), the same way, then commit the file:
    python utils/updater_payload.py prune --libs ... --resources ... --baseline ...

    # what the assembly profile runs before InstallBuilder:
    python utils/updater_payload.py build --libs ... --resources ... --baseline ... --out target/updater-payload

With no baseline file, build copies everything: the updater of the baseline release itself is a full one, and
deleting the file (for the next Java move, 3.0) makes the next updater full again.

prune drops from the baseline the files the release does not ship, or ships changed. Kept, a library that left
the application in a release and came back later identical would be taken for one every installation has,
although those installed by that release never had it: they would miss it from the class path. prune never adds
files: the installations that skipped the release do not have its new ones. build warns about the baseline
files that are not in the application anymore, which a release that has not been pruned after leaves.
"""
import argparse
import hashlib
import os
import shutil
import sys

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


def read_baseline(path):
    baseline = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                digest, name = line.split(" ", 1)
                baseline[name] = digest
    return baseline


def write_baseline(path, digests):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("# Files every installation of this Java version has: see utils/updater_payload.py\n")
        for name, digest in sorted(digests.items()):
            f.write(f"{digest} {name}\n")


def record(args):
    current = files(args)
    write_baseline(args.baseline, {name: sha256(path) for name, path in current.items()})
    print(f"Recorded {len(current)} files in {args.baseline}")


def prune(args):
    """Keeps in the baseline only the files this release ships unchanged; it never adds any."""
    if not os.path.isfile(args.baseline):
        sys.exit(f"No baseline at {args.baseline}: record the first release of this Java version first")
    current = files(args)
    baseline = read_baseline(args.baseline)
    kept = {name: digest for name, digest in baseline.items()
            if name in current and sha256(current[name]) == digest}
    write_baseline(args.baseline, kept)
    print(f"Kept {len(kept)} of {len(baseline)} files in {args.baseline}")
    for name in sorted(set(baseline) - set(kept)):
        print(f"  {'changed' if name in current else 'gone   '} {name}")


def build(args):
    current = files(args)
    baseline = read_baseline(args.baseline) if os.path.isfile(args.baseline) else None
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
    parser.add_argument("--out", help="build: the folder the updater packs")
    args = parser.parse_args()
    if args.command == "record":
        record(args)
    elif args.command == "prune":
        prune(args)
    else:
        if not args.out:
            parser.error("build needs --out")
        build(args)


if __name__ == "__main__":
    main()
