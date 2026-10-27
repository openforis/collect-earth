#!/usr/bin/env python3
"""
Keeps the updaters small: they carry only the libraries and resources that differ from the release every
installation is known to have, the baseline.

Every installation that checks the update manifest of a Java version has been through the first release made
for it (2.0.0 for Java 21): installed by it, or updated by its updater, which carries everything. The updaters
never delete files, so those of the baseline are all still there, and an updater only needs what is new or has
changed since. The libraries are most of an updater (107 MB of jars that rarely change), and the demo survey
in resources another 8 MB.

    # after releasing the baseline (2.0.0), from the release checkout, then commit the file:
    python utils/updater_payload.py record --libs collect-earth-app/target/earth-libs \
        --resources collect-earth-app/resources --baseline collect-earth-installer/src/main/updater-baseline.txt

    # what the assembly profile runs before InstallBuilder:
    python utils/updater_payload.py build --libs ... --resources ... --baseline ... --out target/updater-payload

With no baseline file, build copies everything: the updater of the baseline release itself is a full one, and
deleting the file (for the next Java move, 3.0) makes the next updater full again.

A file that leaves the application and comes back later identical to the baseline would be taken for one every
installation has, although the installations made in between never had it. build warns about the baseline files
that are not in the application anymore: if one of them comes back, delete its line from the baseline.
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


def record(args):
    current = files(args)
    with open(args.baseline, "w", encoding="utf-8", newline="\n") as f:
        f.write("# Files every installation of this Java version has: see utils/updater_payload.py\n")
        for name, path in sorted(current.items()):
            f.write(f"{sha256(path)} {name}\n")
    print(f"Recorded {len(current)} files in {args.baseline}")


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
        print(f"Baseline files the application does not have anymore (should one of them come back identical, delete its"
              f" line from {args.baseline}, or the installations made without it will not get it):")
        for name in gone:
            print(f"  {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("record", "build"))
    parser.add_argument("--libs", required=True, help="the earth-libs folder of the build")
    parser.add_argument("--resources", required=True, help="the resources folder of collect-earth-app")
    parser.add_argument("--baseline", required=True, help="the baseline file")
    parser.add_argument("--out", help="build: the folder the updater packs")
    args = parser.parse_args()
    if args.command == "record":
        record(args)
    else:
        if not args.out:
            parser.error("build needs --out")
        build(args)


if __name__ == "__main__":
    main()
