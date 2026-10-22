#!/bin/sh
# fiks git shim (paper/PLAN.md P4): first on PATH in every run, on the host and in the sandbox image.
# Any push is recorded as one JSON line and refused (exit 1); every other git command goes to the
# real git. The log and the real git are fixed when the shim is installed (placeholders below), so
# the shim needs no environment variable. A PATH shim cannot see a real git run by absolute path, or
# `git` run from a hook or shell-alias script (git puts its exec-path, which holds the real git, first on
# PATH for those); see src/shim.ts.
log='@@FIKS_SHIM_LOG@@'
real='@@FIKS_REAL_GIT@@'

esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n\t\r' '   '; }

# A push spelled through an alias: git looks an alias up only when the subcommand is not a builtin,
# and reads it from every config source (repo, global, system, include.path, -c, GIT_CONFIG_COUNT/
# GIT_CONFIG_KEY_n/VALUE_n, GIT_CONFIG_PARAMETERS). So we ask the real git itself, with the same
# leading global options (-C, -c, --git-dir, ...), and follow alias chains. An expansion that mentions
# push, send-pack or http-push anywhere (including a '!' shell alias) is blocked.
# alias_value <n> <name> <argv...>: the alias value as the real git would read it, given argv's first
# <n> words as the global options.
alias_value() {
  n=$1
  name=$2
  shift 2
  total=$#
  i=0
  for w in "$@"; do
    i=$((i + 1))
    if [ "$i" -le "$n" ]; then set -- "$@" "$w"; fi
  done
  shift "$total"
  "$real" "$@" config --get "alias.$name" 2>/dev/null
}

# The first word of an alias expansion that git would run as the subcommand (skipping global options
# and their values), or nothing for a '!' shell alias.
alias_sub() {
  case "$1" in '!'*) return ;; esac
  set -f
  sk=''
  for w in $1; do
    if [ -n "$sk" ]; then
      sk=''
      continue
    fi
    case "$w" in
      -C | -c | --git-dir | --work-tree | --namespace | --exec-path | --super-prefix | --config-env) sk=1 ;;
      -*) ;;
      *)
        printf '%s' "$w"
        return
        ;;
    esac
  done
}

# Builtins: git never consults an alias for these, so they skip the extra config lookup.
builtin_sub() {
  case "$1" in
    add | am | apply | bisect | blame | branch | cat-file | check-ignore | checkout | cherry-pick | clean | \
      clone | commit | commit-tree | config | describe | diff | diff-files | diff-index | diff-tree | fetch | \
      for-each-ref | format-patch | fsck | gc | grep | hash-object | help | init | log | ls-files | \
      ls-remote | ls-tree | merge | merge-base | mv | notes | read-tree | rebase | reflog | remote | reset | \
      restore | rev-list | rev-parse | revert | rm | shortlog | show | show-ref | stash | status | switch | \
      symbolic-ref | tag | update-index | update-ref | var | version | worktree | write-tree) return 0 ;;
  esac
  return 1
}

blocked=''
sub=''
nglobal=0
skip=''
for a in "$@"; do
  if [ -z "$sub" ]; then nglobal=$((nglobal + 1)); fi
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
      *)
        sub="$a"
        nglobal=$((nglobal - 1))
        ;;
    esac
  fi
done
case "$sub" in push | send-pack | http-push) blocked="$sub" ;; esac

# Follow the alias chain (git refuses loops; we stop after 10 hops).
name="$sub"
hops=0
while [ -z "$blocked" ] && [ -n "$name" ] && [ "$hops" -lt 10 ] && ! builtin_sub "$name"; do
  case "$name" in -* | *=*) break ;; esac
  val=$(alias_value "$nglobal" "$name" "$@") || break
  case "$val" in
    *push* | *send-pack*)
      if [ "$name" = "$sub" ]; then blocked="alias $sub=$val"; else blocked="alias $sub via $name=$val"; fi
      break
      ;;
  esac
  name=$(alias_sub "$val")
  hops=$((hops + 1))
done

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
