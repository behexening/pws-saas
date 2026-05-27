#!/bin/sh

# Xcode Cloud post-clone hook. Runs after the repo is cloned, before
# Xcode begins the build. The Pods/ directory is gitignored (correctly
# — it's generated), so the build fails with "Unable to open base
# configuration reference file ... Pods-App.release.xcconfig" unless
# we re-materialize it here.
#
# Apple looks for ci_scripts/ as a sibling of the .xcworkspace, so
# this script lives at ios/App/ci_scripts/ci_post_clone.sh (not at
# repo root — that placement gets silently ignored).

set -e

echo "── Xcode Cloud post-clone: installing CocoaPods + running pod install ──"
echo "PWD=$PWD"
echo "CI_PRIMARY_REPOSITORY_PATH=$CI_PRIMARY_REPOSITORY_PATH"

# Resolve the App directory robustly. We're running from inside
# ios/App/ci_scripts/, so the .xcworkspace is one directory up.
# CI_PRIMARY_REPOSITORY_PATH points at the repo root on Xcode Cloud;
# we fall back to a path relative to this script if it's unset
# (covers running this script locally for testing).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
echo "APP_DIR=$APP_DIR"

# Xcode Cloud's base image ships with Ruby + gem but not necessarily
# cocoapods. Install it for this build only.
if ! command -v pod >/dev/null 2>&1; then
  echo "Installing cocoapods…"
  sudo gem install cocoapods --no-document
fi

cd "$APP_DIR"
pod install --repo-update
echo "── Pods ready ──"
