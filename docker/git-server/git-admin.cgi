#!/usr/bin/env bash
set -euo pipefail

respond() {
  local status="$1" body="${2:-}"
  printf "Status: %s\r\nContent-Type: application/json\r\n\r\n%s" "$status" "$body"
}

TOKEN="${HTTP_X_ADMIN_TOKEN:-}"
EXPECTED="${MICROSERVICE_AUTH_TOKEN:-}"

# When MICROSERVICE_AUTH_TOKEN is unset the server runs in standalone mode.
# When it is set the X-Admin-Token header must match exactly.
if [[ -n "${EXPECTED}" ]] && [[ "${TOKEN}" != "${EXPECTED}" ]]; then
  respond "403 Forbidden" '{"error":"forbidden"}'
  exit 0
fi

METHOD="${REQUEST_METHOD:-GET}"
URI="${REQUEST_URI:-}"
QUERY="${QUERY_STRING:-}"
REPOS_DIR="${REPOS_DIR:-/git-server/repos}"
KEYS_DIR="${KEYS_DIR:-/git-server/keys}"
GIT_HTTP_RECEIVEPACK_DEFAULT="${GIT_HTTP_RECEIVEPACK_DEFAULT:-true}"

# Strip /admin/ prefix: /admin/repos/alice/myrepo → repos/alice/myrepo
INFO="${URI#/admin/}"
TYPE="${INFO%%/*}"
TARGET="${INFO#*/}"

case "${TYPE}" in

  repos)
    OWNER="${TARGET%%/*}"
    NAME="${TARGET#*/}"
    NAME="${NAME%.git}"
    REPO_PATH="${REPOS_DIR}/${OWNER}/${NAME}.git"

    if [[ "${METHOD}" == "POST" ]]; then
      mkdir -p "${REPOS_DIR}/${OWNER}"

      if [[ "${QUERY}" == clone-from=* ]]; then
        SOURCE="${QUERY#clone-from=}"
        SRC_OWNER="${SOURCE%%/*}"
        SRC_NAME="${SOURCE#*/}"
        SRC_NAME="${SRC_NAME%.git}"
        SOURCE_PATH="${REPOS_DIR}/${SRC_OWNER}/${SRC_NAME}.git"
        if [[ ! -d "${SOURCE_PATH}" ]]; then
          respond "404 Not Found" '{"error":"source repo not found"}'
          exit 0
        fi
        git clone --bare "${SOURCE_PATH}" "${REPO_PATH}" >/dev/null 2>&1
        chmod -R g+w "${REPO_PATH}" 2>/dev/null || true
      else
        if [[ ! -d "${REPO_PATH}" ]]; then
          # Match manage-repo: HEAD must point at main or JGit clients fail to
          # clone with "Remote branch 'HEAD' not found in upstream origin".
          git init --bare --shared=group --initial-branch=main "${REPO_PATH}" >/dev/null 2>&1 || {
            git init --bare --shared=group "${REPO_PATH}" >/dev/null 2>&1
            git --git-dir="${REPO_PATH}" symbolic-ref HEAD refs/heads/main
          }
          if [[ "${GIT_HTTP_RECEIVEPACK_DEFAULT}" == "true" ]]; then
            git -C "${REPO_PATH}" config http.receivepack true
          fi
        fi
      fi
      respond "201 Created" "{\"repo\":\"${OWNER}/${NAME}.git\"}"

    elif [[ "${METHOD}" == "DELETE" ]]; then
      if [[ -d "${REPO_PATH}" ]]; then
        rm -rf "${REPO_PATH}"
        respond "204 No Content"
      else
        respond "404 Not Found" '{"error":"not found"}'
      fi

    else
      respond "405 Method Not Allowed" '{"error":"method not allowed"}'
    fi
    ;;

  keys)
    USERNAME="${TARGET}"
    KEY_FILE="${KEYS_DIR}/${USERNAME}.key"

    if [[ "${METHOD}" == "PUT" ]]; then
      cat > "${KEY_FILE}"
      respond "200 OK" "{\"username\":\"${USERNAME}\"}"

    elif [[ "${METHOD}" == "DELETE" ]]; then
      if [[ -f "${KEY_FILE}" ]]; then
        rm -f "${KEY_FILE}"
        respond "204 No Content"
      else
        respond "404 Not Found" '{"error":"not found"}'
      fi

    else
      respond "405 Method Not Allowed" '{"error":"method not allowed"}'
    fi
    ;;

  *)
    respond "400 Bad Request" '{"error":"bad request"}'
    ;;
esac
