#!/bin/sh
# fiks git shim (paper/PLAN.md P4): first on PATH in every run, on the host and in the sandbox image.
# Any push is recorded as one JSON line and refused (exit 1); every other git command goes to the
# real git. The log and the real git are fixed when the shim is installed (placeholders below), so
# the shim needs no environment variable.
log='@@FIKS_SHIM_LOG@@'
real='@@FIKS_REAL_GIT@@'

esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n\t\r' '   '; }

blocked=''
sub=''
skip=''
for a in "$@"; do
  if [ -n "$skip" ]; then
    # The value of a global option that takes one (-C <dir>, -c <name=value>, ...).
    if [ "$skip" = '-c' ]; then
      case "$a" in alias.*push* | alias.*send-pack* | *pushurl* | remote.*.receivepack*) blocked="config $a" ;; esac
    fi
    skip=''
    continue
  fi
  if [ -z "$sub" ]; then
    case "$a" in
      -C | -c | --git-dir | --work-tree | --namespace | --exec-path | --super-prefix | --config-env) skip="$a" ;;
      -c*) case "$a" in *alias.*push* | *alias.*send-pack*) blocked="config $a" ;; esac ;;
      --config-env=*) case "$a" in *alias.*) blocked="config $a" ;; esac ;;
      -*) ;;
      *) sub="$a" ;;
    esac
  fi
done
case "$sub" in push | send-pack | http-push) blocked="$sub" ;; esac

if [ -n "$blocked" ]; then
  args=''
  for a in "$@"; do args="$args${args:+,}\"$(esc "$a")\""; done
  at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '{"at":"%s","cwd":"%s","reason":"%s","argv":[%s]}\n' "$at" "$(esc "$PWD")" "$(esc "$blocked")" "$args" >>"$log" 2>/dev/null
  echo "fiks: git $blocked is blocked in this run (recorded)" >&2
  exit 1
fi

if [ ! -x "$real" ]; then
  echo "fiks: git is not available here" >&2
  exit 127
fi
exec "$real" "$@"
