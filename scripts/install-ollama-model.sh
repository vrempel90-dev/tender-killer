#!/bin/sh
set -eu
case "${1:-}" in qwen3:4b|qwen3:8b) ;; *) echo 'Specify qwen3:4b or qwen3:8b' >&2; exit 2;; esac
export OLLAMA_HOST=127.0.0.1:11434
export OLLAMA_NO_CLOUD=1
ollama serve >/dev/null 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT INT TERM
attempt=0
until ollama list >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then echo 'Ollama did not start' >&2; exit 1; fi
  sleep 1
done
ollama pull "$1"
