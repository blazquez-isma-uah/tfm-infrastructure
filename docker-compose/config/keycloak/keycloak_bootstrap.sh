#!/usr/bin/env bash
set -euo pipefail
# Script idempotente (si no existen los crea y si sí existe no hace nada) para configurar Keycloak:
# - crear realm
# - crear roles (ADMIN, MUSICIAN)
# - crear client público (sin secret) para frontend
# - crear usuarios con roles
# Requiere 'jq' (sudo apt install jq)


# =======================
# Config por entorno (puedes exportarlas antes de ejecutar)
# =======================
KC_URL="${KC_URL:-http://localhost:8080}"        # URL pública de Keycloak (host)
KC_ADMIN_USER="${KC_ADMIN_USER:-admin}"          # admin console user
KC_ADMIN_PASS="${KC_ADMIN_PASS:-admin}"          # admin console pass
KC_REALM="${KC_REALM:-tfm-bandas}"

CLIENT_ID="${CLIENT_ID:-frontend-local}"
# URIs para Postman y un front local (ajusta si quieres)
REDIRECT_URIS_DEFAULT='["https://oauth.pstmn.io/v1/callback","http://localhost:3000/*"]'
WEB_ORIGINS_DEFAULT='["*"]'   # Para dev; en prod, restringe

# Usuarios a crear
U1_USERNAME="${U1_USERNAME:-ismablazquez}"
U1_PASSWORD="${U1_PASSWORD:-123456}"
U1_ROLE="${U1_ROLE:-MUSICIAN}"

U2_USERNAME="${U2_USERNAME:-admin}"
U2_PASSWORD="${U2_PASSWORD:-admin123}"
U2_ROLE="${U2_ROLE:-ADMIN}"

# =======================
# Helpers
# =======================
api() { # method path [json-body]
  local METHOD="$1"; shift
  local PATH="$1"; shift
  local DATA="${1:-}"
  if [[ -n "$DATA" ]]; then
    curl -sfS -X "$METHOD" "$KC_URL$PATH" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$DATA"
  else
    curl -sfS -X "$METHOD" "$KC_URL$PATH" \
      -H "Authorization: Bearer $TOKEN"
  fi
}

api_relaxed() { # igual que api pero no falla si 409/404
  set +e
  local METHOD="$1"; shift
  local PATH="$1"; shift
  local DATA="${1:-}"
  local OUT
  if [[ -n "$DATA" ]]; then
    OUT=$(curl -s -o /tmp/kc.out -w "%{http_code}" -X "$METHOD" "$KC_URL$PATH" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$DATA")
  else
    OUT=$(curl -s -o /tmp/kc.out -w "%{http_code}" -X "$METHOD" "$KC_URL$PATH" \
      -H "Authorization: Bearer $TOKEN")
  fi
  local CODE="$OUT"
  if [[ "$CODE" == "409" || "$CODE" == "404" || "$CODE" == "204" || "$CODE" == "200" || "$CODE" == "201" ]]; then
    cat /tmp/kc.out
    rm -f /tmp/kc.out
    set -e
    return 0
  fi
  echo "Keycloak API error ($CODE): $(cat /tmp/kc.out)" >&2
  rm -f /tmp/kc.out
  set -e
  return 1
}

get_admin_token() {
  TOKEN="$(curl -sfS -X POST "$KC_URL/realms/master/protocol/openid-connect/token" \
    -d grant_type=password \
    -d client_id=admin-cli \
    -d username="$KC_ADMIN_USER" \
    -d password="$KC_ADMIN_PASS" | jq -r .access_token)"
}

ensure_realm() {
  echo ">> Asegurando realm '$KC_REALM'..."
  # intenta GET; si 404, crea
  if ! curl -sfS "$KC_URL/admin/realms/$KC_REALM" -H "Authorization: Bearer $TOKEN" >/dev/null; then
    api POST "/admin/realms" "$(jq -n --arg r "$KC_REALM" '{realm:$r, enabled:true}')"
  fi
}

ensure_role() {
  local ROLE="$1"
  echo ">> Asegurando rol '$ROLE'..."
  api_relaxed POST "/admin/realms/$KC_REALM/roles" "$(jq -n --arg n "$ROLE" '{name:$n}')"
}

get_role_rep() {
  local ROLE="$1"
  api GET "/admin/realms/$KC_REALM/roles/$ROLE"
}

ensure_client_public() {
  local CID="$1"
  local REDIRS="${2:-$REDIRECT_URIS_DEFAULT}"
  local ORIGINS="${3:-$WEB_ORIGINS_DEFAULT}"

  echo ">> Asegurando client público '$CID'..."
  local ARR
  ARR="$(api GET "/admin/realms/$KC_REALM/clients?clientId=$CID")"
  local ID
  ID="$(echo "$ARR" | jq -r '.[0]?.id')"

  local PAYLOAD
  PAYLOAD="$(jq -n \
    --arg clientId "$CID" \
    --argjson redirectUris "$REDIRS" \
    --argjson webOrigins "$ORIGINS" \
    '{
      clientId: $clientId,
      publicClient: true,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: true,
      implicitFlowEnabled: false,
      serviceAccountsEnabled: false,
      redirectUris: $redirectUris,
      webOrigins: $webOrigins,
      attributes: { "pkce.code.challenge.method": "S256" }
    }'
  )"

  if [[ "$ID" == "null" || -z "$ID" ]]; then
    api POST "/admin/realms/$KC_REALM/clients" "$PAYLOAD"
  else
    api PUT "/admin/realms/$KC_REALM/clients/$ID" "$PAYLOAD"
  fi
}

ensure_user_with_role() {
  local USER="$1" PASS="$2" ROLE="$3"

  echo ">> Asegurando usuario '$USER' con rol '$ROLE'..."
  local ARR
  ARR="$(api GET "/admin/realms/$KC_REALM/users?username=$USER")"
  local UID
  UID="$(echo "$ARR" | jq -r '.[0]?.id')"

  if [[ "$UID" == "null" || -z "$UID" ]]; then
    UID="$(api_relaxed POST "/admin/realms/$KC_REALM/users" \
      "$(jq -n --arg u "$USER" '{username:$u, enabled:true, emailVerified:false}')" | jq -r '."id" // empty')"
    # si el Location header no nos dio ID, búsquelo
    if [[ -z "$UID" ]]; then
      ARR="$(api GET "/admin/realms/$KC_REALM/users?username=$USER")"
      UID="$(echo "$ARR" | jq -r '.[0]?.id')"
    fi
  fi

  # set password (reset endpoint)
  api PUT "/admin/realms/$KC_REALM/users/$UID/reset-password" \
    "$(jq -n --arg p "$PASS" '{type:"password", value:$p, temporary:false}')"

  # asignar rol de realm
  local ROLE_REP
  ROLE_REP="$(get_role_rep "$ROLE")"
  api_relaxed POST "/admin/realms/$KC_REALM/users/$UID/role-mappings/realm" "[$ROLE_REP]"
}

main() {
  echo "== Keycloak bootstrap en $KC_URL, realm '$KC_REALM' =="
  get_admin_token
  ensure_realm
  ensure_role "ADMIN"
  ensure_role "MUSICIAN"
  ensure_client_public "$CLIENT_ID" "$REDIRECT_URIS_DEFAULT" "$WEB_ORIGINS_DEFAULT"
  ensure_user_with_role "$U1_USERNAME" "$U1_PASSWORD" "$U1_ROLE"
  ensure_user_with_role "$U2_USERNAME" "$U2_PASSWORD" "$U2_ROLE"
  echo "== Listo. =="
}

main "$@"

# Ejecútalo con:
#   bash config/keycloak/keycloak_bootstrap.sh
# O 
# cd infraestructura
# # Opcional: exporta variables si no usas los defaults
# export KC_URL=http://localhost:8080
# export KC_ADMIN_USER=admin
# export KC_ADMIN_PASS=admin
# export KC_REALM=tfm-bandas

# # Ejecuta (requiere 'jq')
# bash keycloak_bootstrap.sh
