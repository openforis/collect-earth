#!/usr/bin/env python3
"""Rebuild demo_survey.cep with the web form from the demo_survey_web staging folder.

Takes the existing demo_survey.cep, adds/replaces balloon_web.html and the
webFiles/ tree from this staging folder, and appends the balloon_web key to
project_definition.properties (idempotent). Zip entries always use forward
slashes (Java's ZipFile requires them; PowerShell's Compress-Archive does not
guarantee that, hence this script).

Run from anywhere:  python repackage.py
"""
import os
import shutil
import tempfile
import zipfile

STAGING = os.path.dirname(os.path.abspath(__file__))
CEP = os.path.normpath(os.path.join(STAGING, "..", "demo_survey.cep"))
BALLOON_WEB_LINE = "balloon_web=${project_path}/balloon_web.html"


def main():
    workdir = tempfile.mkdtemp(prefix="cep_repack_")
    try:
        with zipfile.ZipFile(CEP) as zin:
            zin.extractall(workdir)

        # Add/replace the web form and its assets
        shutil.copy(os.path.join(STAGING, "balloon_web.html"), os.path.join(workdir, "balloon_web.html"))
        dest_webfiles = os.path.join(workdir, "webFiles")
        if os.path.isdir(dest_webfiles):
            shutil.rmtree(dest_webfiles)
        shutil.copytree(os.path.join(STAGING, "webFiles"), dest_webfiles)

        # Append the balloon_web key (idempotent), preserving the file bytes otherwise
        props = os.path.join(workdir, "project_definition.properties")
        with open(props, "r", encoding="latin-1") as f:
            content = f.read()
        if "balloon_web=" not in content:
            if not content.endswith("\n"):
                content += "\n"
            content += BALLOON_WEB_LINE + "\n"
            with open(props, "w", encoding="latin-1", newline="") as f:
                f.write(content)

        # Re-zip with forward-slash entry names
        tmp_zip = CEP + ".tmp"
        with zipfile.ZipFile(tmp_zip, "w", zipfile.ZIP_DEFLATED) as zout:
            for root, _dirs, files in os.walk(workdir):
                for name in files:
                    full = os.path.join(root, name)
                    arcname = os.path.relpath(full, workdir).replace(os.sep, "/")
                    zout.write(full, arcname)
        os.replace(tmp_zip, CEP)

        with zipfile.ZipFile(CEP) as z:
            names = z.namelist()
            assert "balloon.html" in names, "legacy balloon missing!"
            assert "balloon_web.html" in names, "web balloon missing!"
            assert any(n.startswith("webFiles/") for n in names), "webFiles missing!"
            assert all("\\" not in n for n in names), "backslash zip entries!"
            props_content = z.read("project_definition.properties").decode("latin-1")
            assert "balloon_web=" in props_content, "balloon_web key missing!"
        print("OK: %s rebuilt (%d entries)" % (CEP, len(names)))
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    main()
