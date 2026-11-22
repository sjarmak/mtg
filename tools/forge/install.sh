#!/usr/bin/env bash
# Downloads Forge 2.0.14 into tools/forge/dist, the default place the lab looks
# for it, and checks the tools a printed-format match needs at run time.
#
# Forge is GPL-3.0 and stays a downloaded artifact: this script fetches the
# upstream release from GitHub and nothing here is committed (see README.md).
# The checksum pins the exact archive the lab's printed formats were admitted
# against, so a re-published or truncated download stops here rather than
# surfacing later as a match that refuses to start.
set -euo pipefail

VERSION=2.0.14
ARCHIVE="forge-installer-${VERSION}.tar.bz2"
URL="https://github.com/Card-Forge/forge/releases/download/forge-${VERSION}/${ARCHIVE}"
SHA256=e71749376945177d603d52a21a089bc1574330cf34599544b6bae1a04c83da41
JAR="forge-gui-desktop-${VERSION}-jar-with-dependencies.jar"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dist="${here}/dist"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

java_major() {
  # `javac 21.0.5` / `openjdk version "21.0.5"` -> 21
  "$1" -version 2>&1 | head -n1 | sed -E 's/[^0-9]*([0-9]+).*/\1/'
}

missing=()
for tool in java javac; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing+=("$tool (a JDK 21, for example Temurin 21 or openjdk-21-jdk)")
  elif [ "$(java_major "$tool")" -lt 21 ]; then
    missing+=("$tool 21 or newer (found $("$tool" -version 2>&1 | head -n1))")
  fi
done
if ! command -v unzip >/dev/null 2>&1; then
  missing+=("unzip, which reads Forge's card list out of its archive")
fi
if [ "$(uname -s)" = Linux ] && ! command -v xvfb-run >/dev/null 2>&1; then
  missing+=("xvfb-run (Debian/Ubuntu: sudo apt install xvfb), because Forge builds a Swing window even when a bot plays")
fi

if [ -f "${dist}/${JAR}" ]; then
  echo "Forge ${VERSION} is already installed in ${dist}."
elif [ -e "${dist}" ]; then
  echo "${dist} exists but holds no ${JAR}. Move it aside and run this again." >&2
  exit 1
else
  # Beside dist rather than in /tmp: the unpacked tree is large, and the final
  # move then stays on one filesystem.
  tmp="$(mktemp -d "${here}/.install.XXXXXX")"
  trap 'rm -rf "${tmp}"' EXIT
  echo "Downloading Forge ${VERSION} (about 300 MB) from ${URL}"
  curl -fL --progress-bar -o "${tmp}/${ARCHIVE}" "${URL}"
  actual="$(sha256_of "${tmp}/${ARCHIVE}")"
  if [ "${actual}" != "${SHA256}" ]; then
    echo "Checksum mismatch for ${ARCHIVE}: expected ${SHA256}, got ${actual}." >&2
    exit 1
  fi
  mkdir -p "${tmp}/dist"
  tar -xjf "${tmp}/${ARCHIVE}" -C "${tmp}/dist"
  if [ ! -f "${tmp}/dist/${JAR}" ]; then
    echo "The archive unpacked without ${JAR}; not installing it." >&2
    exit 1
  fi
  mkdir -p "${here}"
  mv "${tmp}/dist" "${dist}"
  echo "Installed Forge ${VERSION} in ${dist}."
fi

if [ "${#missing[@]}" -gt 0 ]; then
  echo
  echo "Forge is on disk, but printed-format matches also need:"
  for item in "${missing[@]}"; do echo "  - ${item}"; done
  exit 1
fi
echo "Java and Forge are ready. Run npm run play and pick a Magic printed format."
