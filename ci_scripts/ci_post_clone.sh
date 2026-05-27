#!/bin/sh

# Xcode Cloud post-clone hook. Runs after the repo is cloned, before
# Xcode begins the build. The Pods/ directory is gitignored (correctly
# — it's generated), so the build fails with "Unable to open base
# configuration reference file ... Pods-App.release.xcconfig" unless
# we re-materialize it here.
#
# Apple's convention: place this at <repo>/ci_scripts/ci_post_clone.sh
# (also a sibling ci_pre_xcodebuild.sh / ci_post_xcodebuild.sh exist).
# https://developer.apple.com/documentation/xcode/writing-custom-build-scripts

set -e

echo "── Xcode Cloud post-clone: installing CocoaPods + running pod install ──"

# Xcode Cloud's base image ships with Ruby + gem but not necessarily
# cocoapods. Install it locally for this build only.
if ! command -v pod >/dev/null 2>&1; then
  echo "Installing cocoapods…"
  sudo gem install cocoapods --no-document
fi

cd "$CI_WORKSPACE/ios/App"
pod install --repo-update
echo "── Pods ready ──"
