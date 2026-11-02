#!/usr/bin/env bash
#
# Builds the release bundle that wiz-vm deploys (README.md, "Bundle contract"):
#
#   target/bundle/cloud-web-scraper.tar.gz         bootstrap.zip, worker.js, public/
#   target/bundle/cloud-web-scraper.tar.gz.sha256  sha256sum format
#
# `cargo lambda` and Zig must be on PATH; `make bundle` installs them from
# build-requirements.txt. Entries are sorted, owned by 0:0 with normalized modes
# and stamped with SOURCE_DATE_EPOCH (default: the HEAD commit time), so the
# tarball's bytes depend only on the files in it.

set -euo pipefail

cd "$(dirname "$0")/.."

out=target/bundle
stage="$out/stage"
name=cloud-web-scraper.tar.gz
: "${SOURCE_DATE_EPOCH:=$(git log -1 --format=%ct)}"

cargo lambda build --release --arm64 --output-format zip --locked

rm -rf "$out"
mkdir -p "$stage"
cp worker.js "$stage/"
cp -R public "$stage/public"

# cargo-lambda stamps the zip entry with the build time; the binary itself is
# reproducible. Rewrite the zip with the same fixed time so a given commit
# always yields the same bundle.
python3 -I - target/lambda/cloud-web-scraper/bootstrap.zip "$stage/bootstrap.zip" \
	"$SOURCE_DATE_EPOCH" <<'PY'
import sys
import time
import zipfile

source, destination, epoch = sys.argv[1], sys.argv[2], int(sys.argv[3])
with zipfile.ZipFile(source) as built:
    names = built.namelist()
    if names != ["bootstrap"]:
        sys.exit(f"expected only bootstrap in {source}, found {names}")
    binary = built.read("bootstrap")
entry = zipfile.ZipInfo("bootstrap", date_time=time.gmtime(max(epoch, 315532800))[:6])
entry.create_system = 3  # Unix, so Lambda honors the mode bits below.
entry.external_attr = 0o100755 << 16
entry.compress_type = zipfile.ZIP_DEFLATED
with zipfile.ZipFile(destination, "w") as bundle:
    bundle.writestr(entry, binary, compresslevel=9)
PY

tar --create --format=ustar --sort=name --mtime="@$SOURCE_DATE_EPOCH" \
	--owner=0 --group=0 --numeric-owner --mode='u=rwX,go=rX' \
	--directory="$stage" bootstrap.zip public worker.js |
	gzip -9 --no-name >"$out/$name"

# Guard the contract: exactly these three top-level entries, no leading directory.
top="$(tar --list --gzip --file="$out/$name" | cut -d/ -f1 | sort -u | paste -sd' ')"
if [ "$top" != "bootstrap.zip public worker.js" ]; then
	echo "unexpected top-level entries in $name: $top" >&2
	exit 1
fi

(cd "$out" && sha256sum "$name" >"$name.sha256")
rm -rf "$stage"
cat "$out/$name.sha256"
