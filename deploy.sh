#!/bin/zsh
# Puts NoteAlong online (see docs/DEPLOY_REPORT.md), or updates it. Safe to run again.
#
#   SUPA_ORG=<your personal Supabase organization id> ./deploy.sh
#
# Needs, logged in: the Supabase CLI (`supabase login`), Modal (`modal setup`), Vercel (`vercel login`).
# Secrets are kept only in .env.cloud (gitignored) and in the providers' dashboards; nothing is printed.
# Never uploads test-recordings/ (internal testing material): the web app is deployed from web/, the worker
# image holds only service/notealong, and the catalog upload refuses anything outside catalog/.
set -e
cd "$(dirname "$0")"
ROOT=$PWD
# refuse to deploy if internal test material could ship
python3 service/scripts/check_no_test_material.py
ENVF=$ROOT/.env.cloud
# The Supabase organization to create the project in. Required, never guessed: NoteAlong is a personal project and
# must go in the owner's personal organization ("Simon Personal", zchrxexblzgmuwtjowqv). The employer's paid
# organization is refused outright, so nothing can ever be created or billed there.
EMPLOYER_ORG=tbmibpkmyuntvywispqj
if [ -z "$SUPA_ORG" ]; then
  echo "SUPA_ORG is not set. Run it with your personal Supabase organization, for example:"
  echo "  SUPA_ORG=zchrxexblzgmuwtjowqv ./deploy.sh"
  echo "(supabase orgs list shows your organizations and their ids.)"
  exit 1
fi
if [ "$SUPA_ORG" = "$EMPLOYER_ORG" ]; then
  echo "Refusing to deploy into $EMPLOYER_ORG: that is the employer's paid organization. Use your personal one."
  exit 1
fi
SUPA_REGION=${SUPA_REGION:-us-east-1}
VERCEL_SCOPE=${VERCEL_SCOPE:-simonmathiasclg-9145s-projects}
VERCEL_PROJECT=${VERCEL_PROJECT:-notealong}
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
# Modal lives in the service's own Python environment (service/.venv)
[ -x "$ROOT/service/.venv/bin/modal" ] && export PATH="$ROOT/service/.venv/bin:$PATH"
command -v modal >/dev/null && modal app list >/dev/null 2>&1 || { echo "Modal is not set up: run  service/.venv/bin/pip install modal && service/.venv/bin/modal setup"; exit 1; }
vercel whoami >/dev/null 2>&1 || { echo "Vercel CLI is not logged in: run  vercel login"; exit 1; }

say "Supabase project"
if [ -n "$SUPABASE_PROJECT_REF" ]; then
  porg=$(supabase projects list -o json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); ps=d['projects'] if isinstance(d,dict) else d; print(next((p['organization_id'] for p in ps if p['id']=='$SUPABASE_PROJECT_REF'),''))")
  [ "$porg" = "$EMPLOYER_ORG" ] && { echo "The project in .env.cloud ($SUPABASE_PROJECT_REF) is in the employer's organization. Refusing."; exit 1; }
fi
if [ -z "$SUPABASE_PROJECT_REF" ]; then
  [ -n "$SUPABASE_DB_PASSWORD" ] || { setvar SUPABASE_DB_PASSWORD "$(python3 -c 'import secrets,string;a=string.ascii_letters+string.digits;print("".join(secrets.choice(a) for _ in range(32)))')"; load; }
  out=$(supabase projects create notealong --org-id "$SUPA_ORG" --db-password "$SUPABASE_DB_PASSWORD" --region "$SUPA_REGION" -o json 2>&1) || {
    echo "$out" | grep -v -i password; echo "Could not create the Supabase project (see above). If the free plan's limit of 2 projects is the reason, pause one project or upgrade, then run ./deploy.sh again."; exit 1; }
  # the CLI may print a notice (a newer version, say) around the JSON: read from the first brace
  ref=$(echo "$out" | python3 -c "import json,sys; t=sys.stdin.read(); d=json.loads(t[t.index('{'):t.rindex('}')+1]); print(d.get('id') or d.get('ref'))")
  setvar SUPABASE_PROJECT_REF "$ref"; load
  echo "created project $SUPABASE_PROJECT_REF; waiting for it to start"
  for i in {1..60}; do
    st=$(supabase projects list -o json 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); ps=d['projects'] if isinstance(d,dict) else d; print(next((p['status'] for p in ps if p['id']=='$SUPABASE_PROJECT_REF'),''))")
    [ "$st" = "ACTIVE_HEALTHY" ] && break; sleep 10
  done
fi
setvar SUPABASE_URL "https://$SUPABASE_PROJECT_REF.supabase.co"
keys=$(supabase projects api-keys --project-ref "$SUPABASE_PROJECT_REF" --reveal -o json 2>/dev/null)
pick() {  # pick NAME...: the first of these keys the project has (legacy anon/service_role, or the newer kinds)
  echo "$keys" | python3 -c "
import json, sys
d = json.load(sys.stdin)
d = d.get('keys', d) if isinstance(d, dict) else d
by = {(k.get('name') or k.get('type') or '').lower(): k.get('api_key') for k in d}
print(next(by[n] for n in sys.argv[1:] if by.get(n)))" "$@"
}
setvar SUPABASE_ANON_KEY "$(pick anon publishable default)"
setvar SUPABASE_SERVICE_ROLE_KEY "$(pick service_role secret)"
[ -n "$WORKER_SECRET" ] || setvar WORKER_SECRET "$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')"
load

say "Database schema (supabase/migrations)"
supabase link --project-ref "$SUPABASE_PROJECT_REF" -p "$SUPABASE_DB_PASSWORD" >/dev/null
supabase db push -p "$SUPABASE_DB_PASSWORD" --yes

if [ -n "$ADMIN_EMAIL" ]; then
  say "The owner gets the testers' limits"
  for e in ${(s:,:)ADMIN_EMAIL}; do
    e=$(echo "$e" | tr -d ' ' | tr '[:upper:]' '[:lower:]')
    curl -sf -o /dev/null -X POST "$SUPABASE_URL/rest/v1/allowlist" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" -d "{\"email\":\"$e\",\"note\":\"owner\"}" && echo "added the owner to the testers"
  done
fi

say "Built-in songs to storage (catalog/ only)"
service/.venv/bin/python service/scripts/cloud/upload_catalog.py --env "$ENVF" > "$ROOT/logs/catalog-upload.log" 2>&1 || { tail -3 "$ROOT/logs/catalog-upload.log"; echo "The built-in songs didn't all upload (see logs/catalog-upload.log). Run ./deploy.sh again: it carries on where it stopped."; exit 1; }
tail -1 "$ROOT/logs/catalog-upload.log"

say "Processing on Modal"
modal secret create notealong-supabase SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" WORKER_SECRET="$WORKER_SECRET" --force >/dev/null
url=$(cd service && modal deploy modal_app.py 2>&1 | tee "$ROOT/logs/modal-deploy.log" | grep -o 'https://[a-zA-Z0-9.-]*dispatch[a-zA-Z0-9.-]*modal.run' | head -1)
if [ -n "$url" ]; then
  setvar PROCESSING_URL "$url"; load
  curl -sf "$PROCESSING_URL/health" >/dev/null && echo "dispatch is answering"
else
  # the site still goes up (guests and the built-in songs need no processing); converting songs stays off,
  # and says so, until Modal deploys and this script is run again
  grep -i "error" "$ROOT/logs/modal-deploy.log" | tail -2
  echo "Modal did not deploy, so converting songs stays switched off on the site for now. Fix the error above and run ./deploy.sh again."
  PROCESSING_URL=""
fi

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
if [ -n "$PROCESSING_URL" ]; then putenv PROCESSING_URL "$PROCESSING_URL"; else vercel env rm PROCESSING_URL production --yes --scope "$VERCEL_SCOPE" >/dev/null 2>&1 || true; fi
putenv WORKER_SECRET "$WORKER_SECRET"
[ -n "$ADMIN_EMAIL" ] && putenv ADMIN_EMAIL "$ADMIN_EMAIL"
# Google is the main way to sign in once its OAuth client is in Supabase (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
# in .env.cloud); Turnstile guards the email form once its keys are there. Both are optional.
[ -n "$GOOGLE_CLIENT_ID" ] && putenv NEXT_PUBLIC_GOOGLE_AUTH 1
[ -n "$TURNSTILE_SITE_KEY" ] && putenv NEXT_PUBLIC_TURNSTILE_SITE_KEY "$TURNSTILE_SITE_KEY"
site=$(vercel deploy --prod --yes --scope "$VERCEL_SCOPE" 2>&1 | tee /dev/stderr | grep -o "https://$VERCEL_PROJECT[a-zA-Z0-9-]*\.vercel\.app" | tail -1)
cd "$ROOT"
[ -n "$SITE_URL" ] || setvar SITE_URL "${site:-https://$VERCEL_PROJECT.vercel.app}"
load

say "Sign-in settings (site address, email link)"
tmp=$(mktemp -d)
cp -R supabase "$tmp/supabase"
python3 - "$tmp/supabase/config.toml" "$SITE_URL" <<'EOF'
import os, sys, re
path, site = sys.argv[1:]
t = open(path).read()
t = re.sub(r'site_url = ".*"', f'site_url = "{site}"', t, count=1)
t = re.sub(r'additional_redirect_urls = \[.*\]', f'additional_redirect_urls = ["{site}/**", "http://localhost:3001/**"]', t, count=1)
t = t.replace("enable_confirmations = false", "enable_confirmations = true")
if os.environ.get("TURNSTILE_SECRET_KEY"):
    t = t.replace('# [auth.captcha]\n# enabled = true\n# provider = "turnstile"\n# secret = "env(TURNSTILE_SECRET_KEY)"',
                  '[auth.captcha]\nenabled = true\nprovider = "turnstile"\nsecret = "env(TURNSTILE_SECRET_KEY)"')
if os.environ.get("GOOGLE_CLIENT_ID"):
    t += '\n[auth.external.google]\nenabled = true\nclient_id = "env(GOOGLE_CLIENT_ID)"\nsecret = "env(GOOGLE_CLIENT_SECRET)"\nskip_nonce_check = false\n'
open(path, "w").write(t)
EOF
supabase config push --workdir "$tmp" --project-ref "$SUPABASE_PROJECT_REF" --yes || echo "Set the site URL and the email template by hand: see docs/DEPLOY_REPORT.md"
rm -rf "$tmp"

say "Done"
echo "Live at: $SITE_URL"
echo "Make someone a tester (10 songs a day): add their email on $SITE_URL/admin (needs ADMIN_EMAIL) or in Supabase > Table editor > allowlist."
