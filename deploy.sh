#!/bin/zsh
# Puts NoteAlong online as the private beta (see docs/DEPLOY_REPORT.md), or updates it. Safe to run again.
#
#   ./deploy.sh
#
# Needs, logged in: the Supabase CLI (`supabase login`), Modal (`modal setup`), Vercel (`vercel login`).
# Secrets are kept only in .env.cloud (gitignored) and in the providers' dashboards; nothing is printed.
# Never uploads test-recordings/ (internal testing material): the web app is deployed from web/, the worker
# image holds only service/notealong, and the catalog upload refuses anything outside catalog/.
set -e
cd "$(dirname "$0")"
ROOT=$PWD
ENVF=$ROOT/.env.cloud
SUPA_ORG=${SUPA_ORG:-tbmibpkmyuntvywispqj}
SUPA_REGION=${SUPA_REGION:-us-east-1}
VERCEL_SCOPE=${VERCEL_SCOPE:-simonmathiasclg-9145s-projects}
VERCEL_PROJECT=${VERCEL_PROJECT:-notealong-beta}
umask 077
touch "$ENVF"

setvar() {  # setvar NAME VALUE: keep a value in .env.cloud
  python3 - "$ENVF" "$1" "$2" <<'EOF'
import sys
path, name, value = sys.argv[1:]
lines = [l for l in open(path).read().splitlines() if not l.startswith(name + "=")]
lines.append(f"{name}={value}")
open(path, "w").write("\n".join(lines) + "\n")
EOF
}
load() { set -a; source "$ENVF"; set +a; }
say() { print -P "%B==> $1%b"; }
load

say "Checking logins"
supabase projects list -o json >/dev/null 2>&1 || { echo "Supabase CLI is not logged in: run  supabase login"; exit 1; }
command -v modal >/dev/null && modal profile current >/dev/null 2>&1 || { echo "Modal is not set up: run  pip install modal && modal setup"; exit 1; }
vercel whoami >/dev/null 2>&1 || { echo "Vercel CLI is not logged in: run  vercel login"; exit 1; }

say "Supabase project"
if [ -z "$SUPABASE_PROJECT_REF" ]; then
  [ -n "$SUPABASE_DB_PASSWORD" ] || { setvar SUPABASE_DB_PASSWORD "$(python3 -c 'import secrets,string;a=string.ascii_letters+string.digits;print("".join(secrets.choice(a) for _ in range(32)))')"; load; }
  out=$(supabase projects create notealong-beta --org-id "$SUPA_ORG" --db-password "$SUPABASE_DB_PASSWORD" --region "$SUPA_REGION" -o json 2>&1) || {
    echo "$out" | grep -v -i password; echo "Could not create the Supabase project (see above). If the free plan's limit of 2 projects is the reason, pause one project or upgrade, then run ./deploy.sh again."; exit 1; }
  ref=$(echo "$out" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or d.get('ref'))")
  setvar SUPABASE_PROJECT_REF "$ref"; load
  echo "created project $SUPABASE_PROJECT_REF; waiting for it to start"
  for i in {1..60}; do
    st=$(supabase projects list -o json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); ps=d['projects'] if isinstance(d,dict) else d; print(next((p['status'] for p in ps if p['id']=='$SUPABASE_PROJECT_REF'),''))")
    [ "$st" = "ACTIVE_HEALTHY" ] && break; sleep 10
  done
fi
setvar SUPABASE_URL "https://$SUPABASE_PROJECT_REF.supabase.co"
keys=$(supabase projects api-keys --project-ref "$SUPABASE_PROJECT_REF" -o json 2>/dev/null)
setvar SUPABASE_ANON_KEY "$(echo "$keys" | python3 -c "import json,sys; d=json.load(sys.stdin); d=d.get('keys',d) if isinstance(d,dict) else d; print(next(k['api_key'] for k in d if k['name']=='anon'))")"
setvar SUPABASE_SERVICE_ROLE_KEY "$(echo "$keys" | python3 -c "import json,sys; d=json.load(sys.stdin); d=d.get('keys',d) if isinstance(d,dict) else d; print(next(k['api_key'] for k in d if k['name']=='service_role'))")"
[ -n "$WORKER_SECRET" ] || setvar WORKER_SECRET "$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')"
load

say "Database schema (supabase/migrations)"
supabase link --project-ref "$SUPABASE_PROJECT_REF" -p "$SUPABASE_DB_PASSWORD" >/dev/null
supabase db push -p "$SUPABASE_DB_PASSWORD" --yes

say "Built-in songs to storage (catalog/ only)"
service/.venv/bin/python service/scripts/cloud/upload_catalog.py --env "$ENVF" | tail -1

say "Processing on Modal"
modal secret create notealong-supabase SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" WORKER_SECRET="$WORKER_SECRET" --force >/dev/null
url=$(cd service && modal deploy modal_app.py 2>&1 | tee /dev/stderr | grep -o 'https://[a-zA-Z0-9.-]*dispatch[a-zA-Z0-9.-]*modal.run' | head -1)
[ -n "$url" ] || { echo "Could not find the dispatch URL in Modal's output."; exit 1; }
setvar PROCESSING_URL "$url"; load
curl -sf "$PROCESSING_URL/health" >/dev/null && echo "dispatch is answering"

say "Web app on Vercel"
cd web
vercel link --yes --project "$VERCEL_PROJECT" --scope "$VERCEL_SCOPE" >/dev/null
putenv() {  # putenv NAME VALUE: production environment variable on Vercel, value from stdin (never on the command line)
  vercel env rm "$1" production --yes --scope "$VERCEL_SCOPE" >/dev/null 2>&1 || true
  printf '%s' "$2" | vercel env add "$1" production --scope "$VERCEL_SCOPE" >/dev/null
}
putenv NEXT_PUBLIC_SUPABASE_URL "$SUPABASE_URL"
putenv NEXT_PUBLIC_SUPABASE_ANON_KEY "$SUPABASE_ANON_KEY"
putenv SUPABASE_SERVICE_ROLE_KEY "$SUPABASE_SERVICE_ROLE_KEY"
putenv PROCESSING_URL "$PROCESSING_URL"
putenv WORKER_SECRET "$WORKER_SECRET"
[ -n "$ADMIN_EMAIL" ] && putenv ADMIN_EMAIL "$ADMIN_EMAIL"
site=$(vercel deploy --prod --yes --scope "$VERCEL_SCOPE" 2>&1 | tee /dev/stderr | grep -o "https://$VERCEL_PROJECT[a-zA-Z0-9-]*\.vercel\.app" | tail -1)
cd "$ROOT"
[ -n "$SITE_URL" ] || setvar SITE_URL "${site:-https://$VERCEL_PROJECT.vercel.app}"
load

say "Sign-in settings (site address, email link)"
tmp=$(mktemp -d)
cp -R supabase "$tmp/supabase"
python3 - "$tmp/supabase/config.toml" "$SITE_URL" <<'EOF'
import sys, re
path, site = sys.argv[1:]
t = open(path).read()
t = re.sub(r'site_url = ".*"', f'site_url = "{site}"', t, count=1)
t = re.sub(r'additional_redirect_urls = \[.*\]', f'additional_redirect_urls = ["{site}/**", "http://localhost:3000/**"]', t, count=1)
t = t.replace("enable_confirmations = false", "enable_confirmations = true")
open(path, "w").write(t)
EOF
supabase config push --workdir "$tmp" --project-ref "$SUPABASE_PROJECT_REF" --yes || echo "Set the site URL and the email template by hand: see docs/DEPLOY_REPORT.md"
rm -rf "$tmp"

say "Done"
echo "Live at: $SITE_URL"
echo "Invite someone: add their email on $SITE_URL/admin (needs ADMIN_EMAIL) or in Supabase > Table editor > allowlist."
