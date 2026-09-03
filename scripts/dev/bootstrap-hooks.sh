#!/usr/bin/env sh
set -eu

repository_root="$(git rev-parse --show-toplevel)"
virtual_environment="${repository_root}/.local/tools/pre-commit"
python="${virtual_environment}/bin/python"
pre_commit="${virtual_environment}/bin/pre-commit"
export PRE_COMMIT_HOME="${repository_root}/.local/cache/pre-commit"

if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' "Node.js 22 or newer and npm are required to install project tooling." >&2
  exit 1
fi

npm ci --ignore-scripts

if [ ! -x "${python}" ]; then
  python_command=""
  for candidate in python3.13 python3.12 python3.11 python3; do
    if command -v "${candidate}" >/dev/null 2>&1 && \
      "${candidate}" -c 'import sys, venv; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
      python_command="${candidate}"
      break
    fi
  done

  if [ -z "${python_command}" ]; then
    printf '%s\n' "Python 3.11 or newer is required to install project-local hooks." >&2
    exit 1
  fi

  "${python_command}" -m venv --clear "${virtual_environment}"
fi

"${python}" -m pip install --disable-pip-version-check --upgrade 'pip==26.2'
"${python}" -m pip install --disable-pip-version-check 'pre-commit==4.6.0'
"${pre_commit}" install-hooks
git config --local core.hooksPath .githooks

printf '%s\n' "Transaction Risk Gate hooks initialized."
