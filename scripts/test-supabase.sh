#!/usr/bin/env bash
# Pasa src/sync/shared.supabase.test.ts contra un Supabase real en Docker (Postgres + Auth + PostgREST con
# supabase/schema.sql), nunca contra producción. Uso: npm run test:supabase (necesita Docker o Colima en marcha;
# la primera vez descarga las imágenes). Deja el servidor encendido; para pararlo: npm run test:supabase -- stop
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${TMPDIR:-/tmp}/lista-supabase-test"
CLI=(npx -y supabase@2.54.11)
mkdir -p "$DIR/supabase/migrations"
cd "$DIR"
if [ "${1:-}" = "stop" ]; then "${CLI[@]}" stop; exit 0; fi
[ -f supabase/config.toml ] || echo n | "${CLI[@]}" init >/dev/null
cp "$ROOT/supabase/schema.sql" supabase/migrations/20260101000000_schema.sql
if "${CLI[@]}" status >/dev/null 2>&1; then
  "${CLI[@]}" db reset >/dev/null # vuelve a aplicar el esquema por si ha cambiado
else
  "${CLI[@]}" start -x studio,imgproxy,inbucket,mailpit,realtime,storage-api,edge-runtime,logflare,vector,supavisor,postgres-meta
fi
eval "$("${CLI[@]}" status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
cd "$ROOT"
LISTA_SUPABASE_URL="$API_URL" LISTA_SUPABASE_ANON="$ANON_KEY" LISTA_SUPABASE_SERVICE="$SERVICE_ROLE_KEY" \
  npx vitest run src/sync/shared.supabase.test.ts
