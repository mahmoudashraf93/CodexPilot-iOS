#!/usr/bin/env bash
set -euo pipefail

npm install -g shippilot
shippilot doctor --platform ios
shippilot run --case qa/login.md --platform ios
