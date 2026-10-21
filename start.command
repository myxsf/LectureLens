#!/bin/zsh
# Builds whatever is missing, then launches LectureLens from its own directory.
cd "${0:A:h}" || exit 1

if [[ ! -d dist || -z "$(ls -A dist 2>/dev/null)" ]]; then
  echo "正在构建前端…"
  npm run build || exit 1
fi

if [[ ! -x ./lecturelens || server.go -nt ./lecturelens ]]; then
  echo "正在编译本地服务…"
  go build -o lecturelens . || exit 1
fi

exec ./lecturelens
