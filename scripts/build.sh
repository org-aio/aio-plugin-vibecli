#!/bin/sh
set -eu
npm ci
CC=clang npm run check
