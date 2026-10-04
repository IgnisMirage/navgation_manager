#!/usr/bin/env bash
# 開発サーバーを起動する。タブレットからは http://<このPCのIP>:5173 で開ける
# 使い方: ./start.sh [探索フォルダ]
#   アプリで選んだ map.yaml と同じ内容のファイルを、このPC内から探して画像を読み込む。
#   探索フォルダの既定はホームディレクトリ。絞り込みたいときだけ指定する。
set -euo pipefail
cd "$(dirname "$0")"

if [ $# -ge 1 ]; then
  MAPS_DIR="$(realpath "$1")"
  export MAPS_DIR
fi

if [ ! -d node_modules ]; then
  npm install
fi

exec npm run dev
