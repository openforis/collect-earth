#!/usr/bin/env bash
#
# Collect Earth Cloud: deploy (or update) the server in your own Google Cloud project.
#
#   bash deploy/gcp/deploy.sh            # first install, and every later update
#   bash deploy/gcp/deploy.sh --help     # all options
#
# Run it from Google Cloud Shell (it is already logged in), from the
# collect-earth-cloud folder of the Collect Earth repository. It is safe to run
# again: it updates the server to the latest code and never recreates or wipes
# the database. See SELF-HOSTING.md (plain-language guide) and DEPLOY.md
# (technical reference: what this creates, and the same steps by hand).

set -Eeuo pipefail

# --- Names of everything this script creates (keep in sync with DEPLOY.md) -----

SERVICE=collect-earth-cloud          # Cloud Run service
SQL_INSTANCE=ce-cloud-db             # Cloud SQL instance
DB_NAME=collect_earth_cloud          # database inside it
DB_USER=ce                           # database user that owns the tables and migrates
DB_APP_USER=ce_app                   # database role the server runs as (bound by RLS)
SECRET_DB=ce-database-url            # Secret Manager: MIGRATION_DATABASE_URL (owner, ce)
SECRET_DB_APP=ce-app-database-url    # Secret Manager: DATABASE_URL (the app role, ce_app)
SECRET_SETUP=ce-setup-code           # Secret Manager: SETUP_CODE
SA_NAME=ce-cloud-run                 # service account the server runs as
REPO=ce                              # Artifact Registry repository
IMAGE_NAME=collect-earth-cloud       # container image name
LABEL=app=collect-earth-cloud

DEFAULT_REGION=europe-west1
DEFAULT_DB_TIER=db-f1-micro          # the smallest (shared-core) Cloud SQL machine
MAX_INSTANCES=4                      # Cloud Run instances at most (cost ceiling)
# Cloud Run's request timeout in seconds. The Collect Earth backup of a large project streams for
# minutes (100,000 records: about 180 MB, under 20 s on the server, longer on a slow connection),
# and a request still running at the timeout is cut. Raise it to 3600 (Cloud Run's maximum) for
# very large projects or slow connections: REQUEST_TIMEOUT=3600 ./deploy.sh ... (see DEPLOY.md).
# Each instance's memory: 512Mi, or 1Gi above about 30,000 records (MEMORY=1Gi ./deploy.sh ...;
# DEPLOY.md, "Memory"). Unset, a server already deployed keeps the timeout and memory it has (an
# operator may have raised them with gcloud run services update), and a new one gets the defaults.
DEFAULT_REQUEST_TIMEOUT=900
DEFAULT_MEMORY=512Mi
REQUEST_TIMEOUT="${REQUEST_TIMEOUT:-}"
MEMORY="${MEMORY:-}"
DB_MAX_CONNECTIONS=50                # each server instance opens up to 10

# Regions offered when asking (any Cloud Run + Cloud SQL region works with --region).
REGIONS=(
  "europe-west1|Belgium"
  "us-central1|Iowa, USA"
  "us-east1|South Carolina, USA"
  "southamerica-east1|Sao Paulo, Brazil"
  "africa-south1|Johannesburg, South Africa"
  "asia-south1|Mumbai, India"
  "asia-southeast1|Singapore"
)
# Regions where Cloud Run can map your own domain name (--domain).
DOMAIN_MAPPING_REGIONS=" asia-east1 asia-northeast1 asia-southeast1 europe-north1 europe-west1 europe-west4 us-central1 us-east1 us-east4 us-west1 "

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
STATE_DIR="${COLLECT_EARTH_CLOUD_STATE_DIR:-$HOME/.collect-earth-cloud}"
GCLOUD="${GCLOUD:-gcloud}"

# --- Options ---------------------------------------------------------------------

DRY_RUN=false
SHOW_SETUP_CODE=false
ASSUME_YES=false
PULL=true
PROJECT=""
REGION=""
DOMAIN=""
DB_TIER=""
ORIGINAL_ARGS=("$@")

usage() {
  cat <<EOF
Collect Earth Cloud: deploy or update the server in your Google Cloud project.

Usage: bash deploy/gcp/deploy.sh [options]

Run the same command again at any time to update the server to the latest
version. Your data is kept: the database is never recreated.

Options:
  --project ID        Google Cloud project to use (default: the current one,
                      or you are asked to pick one)
  --region REGION     Where the server runs, e.g. europe-west1 (asked once,
                      then remembered)
  --domain NAME       Serve the dashboard on your own address, e.g.
                      cloud.example.org (also sets PUBLIC_BASE_URL)
  --db-tier TIER      Cloud SQL machine for a NEW database (default
                      $DEFAULT_DB_TIER; db-g1-small for a busy public server).
                      Ignored when the database already exists
  --show-setup-code   Print the setup code and the dashboard address, then stop
  --yes, -y           Do not ask for confirmation
  --no-pull           Do not fetch the latest code with git before deploying
  --dry-run           Print every gcloud command instead of running it
                      (works without a Google Cloud project)
  --help, -h          Show this help

Environment:
  REQUEST_TIMEOUT=SECONDS  Cloud Run's request timeout (default $DEFAULT_REQUEST_TIMEOUT; up to
                           3600 for large backups on slow connections)
  MEMORY=SIZE              Memory of each instance (default $DEFAULT_MEMORY; 1Gi above about
                           30,000 records)
  Unset, an update keeps the server's current timeout and memory.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --project=*) PROJECT="${1#*=}"; shift ;;
    --region) REGION="${2:-}"; shift 2 ;;
    --region=*) REGION="${1#*=}"; shift ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --domain=*) DOMAIN="${1#*=}"; shift ;;
    --db-tier) DB_TIER="${2:-}"; shift 2 ;;
    --db-tier=*) DB_TIER="${1#*=}"; shift ;;
    --show-setup-code) SHOW_SETUP_CODE=true; shift ;;
    --yes|-y) ASSUME_YES=true; shift ;;
    --no-pull) PULL=false; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

# --- Output ----------------------------------------------------------------------

if [[ -t 1 ]]; then
  BOLD=$'\e[1m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; RESET=$'\e[0m'
else
  BOLD=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi

STEP_NO=0
STEP_TOTAL=8
CURRENT_STEP="getting started"
HINT=""

say()  { printf '%s\n' "$*"; }
ok()   { printf '%s  %s%s\n' "$GREEN" "$*" "$RESET"; }
warn() { printf '%s  Note: %s%s\n' "$YELLOW" "$*" "$RESET" >&2; }

step() {
  STEP_NO=$((STEP_NO + 1))
  CURRENT_STEP="$1"
  HINT="${2:-}"
  printf '\n%sStep %d of %d: %s%s\n' "$BOLD" "$STEP_NO" "$STEP_TOTAL" "$1" "$RESET"
}

# Stops with a plain-language explanation.
fail() {
  printf '\n%sThe deployment stopped.%s\n' "$RED$BOLD" "$RESET" >&2
  printf '%s\n' "$@" >&2
  exit 1
}

# shellcheck disable=SC2329  # called by the ERR trap below
on_error() {
  local status=$1 line=$2
  trap - ERR
  printf '\n%sSomething went wrong while %s.%s\n' "$RED$BOLD" "${CURRENT_STEP%% (*}" "$RESET" >&2
  printf 'The message from Google Cloud just above says what failed (script line %s, exit code %s).\n' "$line" "$status" >&2
  if [[ -n "$HINT" ]]; then
    printf '%s\n' "$HINT" >&2
  fi
  printf '%s\n' \
    "Nothing was deleted. It is safe to run the same command again once the cause is fixed:" \
    "    bash deploy/gcp/deploy.sh" \
    "If it keeps failing, copy the messages above and ask for help (see SELF-HOSTING.md)." >&2
  exit "$status"
}
trap 'on_error $? $LINENO' ERR

# --- Running gcloud --------------------------------------------------------------

# Prints a command the way it would be typed (on stderr, so it is shown even
# where the command's own output is hidden).
print_cmd() {
  local out="  \$ gcloud" arg q="'"
  for arg in "$@"; do
    if [[ "$arg" =~ ^[A-Za-z0-9_./:=,@%+-]+$ ]]; then
      out+=" $arg"
    else
      out+=" $q${arg//$q/$q\\$q$q}$q"
    fi
  done
  printf '%s\n' "$out" >&2
}

project_flag() {
  if [[ -n "$PROJECT" ]]; then printf -- '--project=%s' "$PROJECT"; fi
}

# A gcloud command that changes something. In --dry-run it is only printed.
gc() {
  local pf; pf="$(project_flag)"
  if $DRY_RUN; then
    print_cmd "$@" ${pf:+"$pf"}
    return 0
  fi
  "$GCLOUD" "$@" ${pf:+"$pf"}
}

# Like gc, but the first argument is a value passed on standard input (secrets),
# so it never appears on a command line or in the dry-run output.
gc_stdin() {
  local data="$1"; shift
  local pf; pf="$(project_flag)"
  if $DRY_RUN; then
    print_cmd "$@" ${pf:+"$pf"}
    printf '      (the value is passed on standard input, not shown)\n' >&2
    return 0
  fi
  printf '%s' "$data" | "$GCLOUD" "$@" ${pf:+"$pf"}
}

# A read-only gcloud command whose output is used. Errors are silenced: callers
# treat "no output / failure" as "does not exist". In --dry-run it is printed and
# answers "does not exist", so the dry run shows the full first-install path.
gq() {
  local pf; pf="$(project_flag)"
  if $DRY_RUN; then
    print_cmd "$@" ${pf:+"$pf"}
    return 1
  fi
  "$GCLOUD" "$@" ${pf:+"$pf"} 2>/dev/null
}

# Retries a gcloud change a few times: new service accounts take a little while
# to be visible everywhere.
gc_retry() {
  local attempt
  for attempt in 1 2 3 4 5; do
    if gc "$@"; then return 0; fi
    if [[ $attempt -lt 5 ]]; then
      say "  (Google Cloud is not ready yet, trying again in $((attempt * 10)) seconds...)"
      sleep $((attempt * 10))
    fi
  done
  return 1
}

# --- Small helpers -----------------------------------------------------------------

interactive() { [[ -t 0 ]] && ! $ASSUME_YES; }

# Random string from an alphabet. No `head -c N` at the end of a pipe (with
# pipefail, the writer's SIGPIPE would fail the script).
random_from() {
  local alphabet="$1" length="$2" raw=""
  while [[ ${#raw} -lt $length ]]; do
    raw+="$(head -c 512 /dev/urandom | LC_ALL=C tr -dc "$alphabet")"
  done
  printf '%s' "${raw:0:$length}"
}

# Same shape as the server's generateSetupCode() (src/accountRules.ts):
# 10 symbols without look-alike characters, grouped XXXX-XXXX-XX.
generate_setup_code() {
  local raw; raw="$(random_from 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' 10)"
  printf '%s-%s-%s' "${raw:0:4}" "${raw:4:4}" "${raw:8:2}"
}

# Letters and digits only, so it needs no escaping inside a URL.
generate_password() { random_from 'A-Za-z0-9' 32; }

state_file() { printf '%s/deploy-%s.conf' "$STATE_DIR" "$PROJECT"; }

load_state() {
  local file key value
  file="$(state_file)"
  [[ -f "$file" ]] || return 0
  while IFS='=' read -r key value; do
    case "$key" in
      REGION) [[ -n "$REGION" ]] || REGION="$value" ;;
      DOMAIN) [[ -n "$DOMAIN" ]] || DOMAIN="$value" ;;
      DB_TIER) [[ -n "$DB_TIER" ]] || DB_TIER="$value" ;;
    esac
  done < "$file"
}

save_state() {
  $DRY_RUN && return 0
  mkdir -p "$STATE_DIR"
  printf 'REGION=%s\nDOMAIN=%s\nDB_TIER=%s\n' "$REGION" "$DOMAIN" "$DB_TIER" > "$(state_file)"
}

# --- Steps ---------------------------------------------------------------------------

check_gcloud() {
  if $DRY_RUN; then
    return 0
  fi
  if ! command -v "$GCLOUD" >/dev/null 2>&1; then
    fail "The Google Cloud command line (gcloud) is not installed here." \
      "The easiest way is to use Google Cloud Shell, where it is ready: open the" \
      "'Open in Cloud Shell' button in SELF-HOSTING.md and run this command there."
  fi
  local account
  account="$("$GCLOUD" auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n 1 || true)"
  if [[ -z "$account" ]]; then
    fail "You are not logged in to Google Cloud in this terminal." \
      "In Cloud Shell this happens when the repository was opened without trusting it" \
      "(a temporary session without your credentials). Open the 'Open in Cloud Shell'" \
      "button again and tick 'Trust repo', or log in now with:" \
      "    gcloud auth login" \
      "then run this command again."
  fi
  say "Logged in to Google Cloud as $account."
}

# Fetches the latest code (the server is built from this folder), then restarts
# the script if it changed, so the newest version of this script runs.
update_code() {
  $DRY_RUN && return 0
  $PULL || return 0
  command -v git >/dev/null 2>&1 || return 0
  git -C "$APP_DIR" rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1 || return 0
  if [[ -n "$(git -C "$APP_DIR" status --porcelain 2>/dev/null)" ]]; then
    warn "this folder has local changes, so the latest code is not downloaded; deploying the code as it is here."
    return 0
  fi
  local before after
  before="$(git -C "$APP_DIR" rev-parse HEAD)"
  say "Downloading the latest version of Collect Earth Cloud..."
  if ! git -C "$APP_DIR" pull --ff-only --quiet; then
    warn "could not download the latest code (see the message above); deploying the code as it is here."
    return 0
  fi
  after="$(git -C "$APP_DIR" rev-parse HEAD)"
  if [[ "$before" != "$after" ]]; then
    say "Updated to the latest version. Restarting the script..."
    exec bash "$SCRIPT_DIR/deploy.sh" --no-pull "${ORIGINAL_ARGS[@]}"
  fi
}

choose_project() {
  if [[ -z "$PROJECT" ]]; then
    if $DRY_RUN; then
      PROJECT="my-project"
      say "Dry run: using the placeholder project '$PROJECT' (pass --project to change it)."
      return 0
    fi
    PROJECT="$("$GCLOUD" config get-value project 2>/dev/null || true)"
    [[ "$PROJECT" == "(unset)" ]] && PROJECT=""
  fi
  if [[ -z "$PROJECT" ]]; then
    local projects=()
    mapfile -t projects < <("$GCLOUD" projects list --format='value(projectId)' --sort-by=projectId 2>/dev/null || true)
    if [[ ${#projects[@]} -eq 0 ]]; then
      fail "No Google Cloud project was found for your account." \
        "Create one at https://console.cloud.google.com/projectcreate (any name, e.g." \
        "'collect-earth-cloud'), then run this command again with:" \
        "    bash deploy/gcp/deploy.sh --project YOUR-PROJECT-ID"
    fi
    if ! [[ -t 0 ]]; then
      fail "No project is selected. Run again with --project YOUR-PROJECT-ID."
    fi
    say "Which Google Cloud project should the server go into?"
    local i
    for i in "${!projects[@]}"; do printf '  %d) %s\n' "$((i + 1))" "${projects[$i]}"; done
    local choice
    read -r -p "Type its number: " choice
    if ! [[ "$choice" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > ${#projects[@]} )); then
      fail "'$choice' is not one of the numbers in the list. Run the command again."
    fi
    PROJECT="${projects[$((choice - 1))]}"
  fi
  if ! $DRY_RUN; then
    if ! "$GCLOUD" projects describe "$PROJECT" --format='value(projectId)' >/dev/null 2>&1; then
      fail "The project '$PROJECT' does not exist, or your account cannot use it." \
        "Check the project ID (not its name) at https://console.cloud.google.com/home/dashboard" \
        "and run again with --project YOUR-PROJECT-ID."
    fi
  fi
}

choose_region() {
  load_state
  if [[ -z "$REGION" ]] && ! $DRY_RUN; then
    # An earlier run that lost its state file: the database tells where it is.
    REGION="$(gq sql instances describe "$SQL_INSTANCE" --format='value(region)' || true)"
  fi
  if [[ -z "$REGION" ]]; then
    if interactive && ! $DRY_RUN; then
      say ""
      say "Where should the server run? Pick the place closest to the people who will use it."
      local i entry
      for i in "${!REGIONS[@]}"; do
        entry="${REGIONS[$i]}"
        printf '  %d) %-20s %s\n' "$((i + 1))" "${entry%%|*}" "${entry#*|}"
      done
      local choice
      read -r -p "Type its number [1 = $DEFAULT_REGION]: " choice
      choice="${choice:-1}"
      if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#REGIONS[@]} )); then
        entry="${REGIONS[$((choice - 1))]}"
        REGION="${entry%%|*}"
      elif [[ "$choice" =~ ^[a-z]+-[a-z]+[0-9]+$ ]]; then
        REGION="$choice"
      else
        fail "'$choice' is not one of the numbers in the list. Run the command again."
      fi
    else
      REGION="$DEFAULT_REGION"
    fi
  fi
  DB_TIER="${DB_TIER:-$DEFAULT_DB_TIER}"
  if [[ -n "$DOMAIN" ]]; then STEP_TOTAL=9; fi
  DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%%/*}"
  if [[ -n "$DOMAIN" && "$DOMAIN_MAPPING_REGIONS" != *" $REGION "* ]]; then
    fail "Your own address (--domain) can only be set up automatically in these regions:" \
      "  $DOMAIN_MAPPING_REGIONS" \
      "The server is in $REGION. Run again without --domain (the dashboard still works on" \
      "its Google address), or see 'Your own address' in DEPLOY.md for other ways."
  fi
}

confirm() {
  say ""
  say "${BOLD}Collect Earth Cloud will be deployed with these settings:${RESET}"
  say "  Google Cloud project: $PROJECT"
  say "  Region:               $REGION"
  say "  Database machine:     $DB_TIER (only used if the database is created now)"
  [[ -n "$DOMAIN" ]] && say "  Your own address:     https://$DOMAIN"
  if interactive && ! $DRY_RUN; then
    local answer
    read -r -p "Continue? [Y/n] " answer
    case "${answer:-y}" in
      y|Y|yes|YES|Yes) ;;
      *) say "Stopped. Nothing was changed."; exit 0 ;;
    esac
  fi
  save_state
}

check_billing() {
  step "checking that billing is turned on" \
    "Billing is how Google Cloud charges for the database. See https://console.cloud.google.com/billing"
  gc services enable cloudbilling.googleapis.com --quiet \
    || warn "could not turn on the Cloud Billing API; trying to check billing anyway."
  local enabled
  if $DRY_RUN; then
    print_cmd billing projects describe "$PROJECT" --format='value(billingEnabled)'
    enabled=True
  else
    enabled="$("$GCLOUD" billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null || true)"
  fi
  case "$enabled" in
    True|true) ok "Billing is on."; return 0 ;;
    "") warn "could not check billing (your account may not be allowed to see it). Continuing; if a later step says billing is off, turn it on at https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT"; return 0 ;;
  esac

  say "Billing is not turned on for project $PROJECT."
  say "Google Cloud needs a billing account (a payment card) before it can create the database,"
  say "even though most of what this server uses is free. You are charged only for what you use."
  local accounts=()
  mapfile -t accounts < <("$GCLOUD" billing accounts list --filter=open=true --format='value(name.basename(),displayName)' 2>/dev/null || true)
  if [[ ${#accounts[@]} -gt 0 ]] && interactive; then
    say "Your billing accounts:"
    local i
    for i in "${!accounts[@]}"; do printf '  %d) %s\n' "$((i + 1))" "${accounts[$i]//$'\t'/  }"; done
    local choice
    read -r -p "Type the number of the one to use for this project (or press Enter to stop): " choice
    if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#accounts[@]} )); then
      local account_id="${accounts[$((choice - 1))]%%$'\t'*}"
      HINT="Linking a billing account needs the 'Billing Account User' permission on it. Ask whoever manages that billing account, or link it yourself at https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT"
      gc billing projects link "$PROJECT" --billing-account="$account_id"
      ok "Billing is on."
      return 0
    fi
  fi
  fail "To turn billing on:" \
    "  1. Open https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT" \
    "  2. Choose a billing account, or create one (you need a payment card)." \
    "  3. Run this command again: bash deploy/gcp/deploy.sh"
}

enable_apis() {
  step "turning on the Google Cloud services the server uses (1 to 2 minutes)" \
    "If it says billing is required, turn billing on (https://console.cloud.google.com/billing) and run again."
  gc services enable \
    run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
    artifactregistry.googleapis.com cloudbuild.googleapis.com iam.googleapis.com \
    cloudresourcemanager.googleapis.com --quiet
  ok "Services are on."
}

create_database() {
  step "preparing the database" \
    "Cloud SQL could not create or find the database. If the name '$SQL_INSTANCE' was used by a database deleted less than a week ago, Google Cloud does not allow reusing it yet."
  local state
  state="$(gq sql instances describe "$SQL_INSTANCE" --format='value(state)' || true)"
  if [[ -n "$state" ]]; then
    local where; where="$(gq sql instances describe "$SQL_INSTANCE" --format='value(region)' || true)"
    ok "The database server already exists (in $where); it is kept as it is, with all its data."
    if [[ -n "$where" && "$where" != "$REGION" ]]; then
      warn "the database is in $where but the server will run in $REGION. It works, but is slower; run again with --region $where to keep them together."
    fi
    if [[ "$state" != "RUNNABLE" ]]; then
      warn "the database server is '$state', not running. If it was stopped, start it in https://console.cloud.google.com/sql/instances?project=$PROJECT"
    fi
  else
    say "Creating the database server. ${BOLD}This takes about 10 to 15 minutes${RESET}; leave this window open."
    gc sql instances create "$SQL_INSTANCE" \
      --database-version=POSTGRES_16 \
      --edition=enterprise \
      --tier="$DB_TIER" \
      --region="$REGION" \
      --availability-type=zonal \
      --storage-type=SSD \
      --storage-size=10 \
      --storage-auto-increase \
      --backup-start-time=02:00 \
      --enable-point-in-time-recovery \
      --retained-backups-count=7 \
      --retained-transaction-log-days=7 \
      --deletion-protection \
      --database-flags="max_connections=$DB_MAX_CONNECTIONS"
    ok "Database server created, with daily backups and protection against deletion."
  fi

  if gq sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" --format='value(name)' >/dev/null; then
    ok "Database '$DB_NAME' is there."
  else
    gc sql databases create "$DB_NAME" --instance="$SQL_INSTANCE"
    ok "Database '$DB_NAME' created."
  fi
}

secret_exists() {
  gq secrets describe "$1" --format='value(name)' >/dev/null
}

create_secrets() {
  step "storing the database passwords and the setup code safely (Secret Manager)"
  CONNECTION_NAME="$PROJECT:$REGION:$SQL_INSTANCE"
  if ! $DRY_RUN; then
    local conn; conn="$(gq sql instances describe "$SQL_INSTANCE" --format='value(connectionName)' || true)"
    [[ -n "$conn" ]] && CONNECTION_NAME="$conn"
  fi

  if secret_exists "$SECRET_DB"; then
    ok "The database password is already stored; it is kept."
  else
    local password url
    if $DRY_RUN; then password="GENERATED_PASSWORD"; else password="$(generate_password)"; fi
    if gq sql users list --instance="$SQL_INSTANCE" --format='value(name)' | grep -qx "$DB_USER"; then
      gc sql users set-password "$DB_USER" --instance="$SQL_INSTANCE" --password="$password"
    else
      gc sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$password"
    fi
    url="postgres://$DB_USER:$password@/$DB_NAME?host=/cloudsql/$CONNECTION_NAME"
    gc_stdin "$url" secrets create "$SECRET_DB" --replication-policy=automatic --data-file=- --labels="$LABEL"
    ok "Database user '$DB_USER' and its password are ready."
  fi

  # The server itself logs in as a second role that does not own the tables, so the
  # database's own project rules (Row-Level Security) apply to it. Only its password is
  # made here: the server creates the role (as '$DB_USER', when it migrates on start),
  # because a user made with 'gcloud sql users create' joins cloudsqlsuperuser. Servers
  # deployed before this step get it on their next update.
  if secret_exists "$SECRET_DB_APP"; then
    ok "The server's own database password is already stored; it is kept."
  else
    local app_password app_url
    if $DRY_RUN; then app_password="GENERATED_PASSWORD"; else app_password="$(generate_password)"; fi
    app_url="postgres://$DB_APP_USER:$app_password@/$DB_NAME?host=/cloudsql/$CONNECTION_NAME"
    gc_stdin "$app_url" secrets create "$SECRET_DB_APP" --replication-policy=automatic --data-file=- --labels="$LABEL"
    ok "The server's own database role '$DB_APP_USER' will be created by the server when it starts."
  fi

  if secret_exists "$SECRET_SETUP"; then
    ok "The setup code is already stored; it is kept."
  else
    local code
    if $DRY_RUN; then code="GENERATED-SETUP-CODE"; else code="$(generate_setup_code)"; fi
    gc_stdin "$code" secrets create "$SECRET_SETUP" --replication-policy=automatic --data-file=- --labels="$LABEL"
    ok "Setup code created."
  fi
}

create_service_account() {
  step "creating the account the server runs as (service account)" \
    "Your Google account needs the Owner role on the project (or IAM admin rights) for this step."
  SA_EMAIL="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
  if gq iam service-accounts describe "$SA_EMAIL" --format='value(email)' >/dev/null; then
    ok "Service account $SA_EMAIL is there."
  else
    gc iam service-accounts create "$SA_NAME" --display-name="Collect Earth Cloud server"
  fi
  gc_retry projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$SA_EMAIL" --role=roles/cloudsql.client --condition=None --quiet >/dev/null
  local secret
  for secret in "$SECRET_DB" "$SECRET_DB_APP" "$SECRET_SETUP"; do
    gc_retry secrets add-iam-policy-binding "$secret" \
      --member="serviceAccount:$SA_EMAIL" --role=roles/secretmanager.secretAccessor --condition=None --quiet >/dev/null
  done
  ok "It may connect to the database and read its three secrets, nothing else."

  # Cloud Build builds the server image with the project's default build account.
  # In projects created since 2024 that account may have no permissions at all.
  local build_sa
  if $DRY_RUN; then
    print_cmd builds get-default-service-account --project="$PROJECT"
    build_sa="PROJECT_NUMBER-compute@developer.gserviceaccount.com"
  else
    build_sa="$(gq builds get-default-service-account | grep -oE '[A-Za-z0-9._-]+@[A-Za-z0-9.-]+' | head -n 1 || true)"
  fi
  if [[ -n "$build_sa" ]]; then
    gc_retry projects add-iam-policy-binding "$PROJECT" \
      --member="serviceAccount:$build_sa" --role=roles/cloudbuild.builds.builder --condition=None --quiet >/dev/null \
      || warn "could not give the build account ($build_sa) permission to build; if the next step fails, see 'Build permissions' in DEPLOY.md."
  fi
}

create_repository() {
  step "preparing the place where server versions are stored (Artifact Registry)"
  if gq artifacts repositories describe "$REPO" --location="$REGION" --format='value(name)' >/dev/null; then
    ok "Repository '$REPO' is there."
  else
    gc artifacts repositories create "$REPO" --repository-format=docker --location="$REGION" \
      --description="Collect Earth Cloud server images" --labels="$LABEL"
  fi
  # Keep the 5 newest images, delete older ones after 30 days (storage costs money).
  gc artifacts repositories set-cleanup-policies "$REPO" --location="$REGION" \
    --policy="$SCRIPT_DIR/cleanup-policy.json" --quiet >/dev/null \
    || warn "could not set the clean-up rule for old server versions; this only affects a few cents of storage."
}

build_image() {
  step "building the server from the latest code (3 to 6 minutes)" \
    "Cloud Build could not build the server. If the message mentions a missing permission for a service account, see 'Build permissions' in DEPLOY.md."
  local tag
  tag="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo local)-$(date +%Y%m%d-%H%M%S)"
  IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPO/$IMAGE_NAME:$tag"
  # Run from the collect-earth-cloud folder: it is the Dockerfile's build context.
  cd "$APP_DIR"
  gc builds submit . --tag="$IMAGE" --ignore-file=deploy/gcp/build.gcloudignore
  ok "Server version $tag built."
}

deploy_service() {
  step "starting the server (Cloud Run, about 1 minute)" \
    "Cloud Run could not start the new version. The previous version, if any, keeps running. Its log may say why: gcloud run services logs read $SERVICE --region $REGION --project $PROJECT"
  local env_vars="STORE_BACKEND=postgres,MIGRATE_ON_BOOT=true"
  [[ -n "$DOMAIN" ]] && env_vars+=",PUBLIC_BASE_URL=https://$DOMAIN"
  # An update keeps the memory and timeout the server has, unless MEMORY / REQUEST_TIMEOUT say otherwise.
  local memory="$MEMORY" timeout="$REQUEST_TIMEOUT" current="" current_memory="" current_timeout=""
  if [[ -z "$memory" || -z "$timeout" ]]; then
    current="$(gq run services describe "$SERVICE" --region="$REGION" \
      --format='value(spec.template.spec.containers[0].resources.limits.memory,spec.template.spec.timeoutSeconds)' || true)"
    read -r current_memory current_timeout <<<"$current" || true
  fi
  memory="${memory:-${current_memory:-$DEFAULT_MEMORY}}"
  timeout="${timeout:-${current_timeout:-$DEFAULT_REQUEST_TIMEOUT}}"
  gc run deploy "$SERVICE" \
    --image="$IMAGE" \
    --region="$REGION" \
    --platform=managed \
    --service-account="$SA_EMAIL" \
    --add-cloudsql-instances="$CONNECTION_NAME" \
    --update-secrets="DATABASE_URL=$SECRET_DB_APP:latest,MIGRATION_DATABASE_URL=$SECRET_DB:latest,SETUP_CODE=$SECRET_SETUP:latest" \
    --update-env-vars="$env_vars" \
    --allow-unauthenticated \
    --port=8080 \
    --cpu=1 \
    --memory="$memory" \
    --min-instances=0 \
    --max-instances="$MAX_INSTANCES" \
    --concurrency=80 \
    --timeout="$timeout" \
    --cpu-boost \
    --labels="$LABEL" \
    --quiet

  if $DRY_RUN; then
    SERVICE_URL="https://$SERVICE-PROJECT_NUMBER.$REGION.run.app"
  else
    SERVICE_URL="$(gq run services describe "$SERVICE" --region="$REGION" --format='value(status.url)' || true)"
  fi

  # Everyone must be able to open the dashboard. Some organisations forbid public
  # services ("domain restricted sharing"); then --allow-unauthenticated only warns.
  if ! $DRY_RUN; then
    if ! gq run services get-iam-policy "$SERVICE" --region="$REGION" --format=json | grep -q '"allUsers"'; then
      say "Your organisation's rules did not allow making the server public the usual way; trying the other way..."
      if ! gc run services update "$SERVICE" --region="$REGION" --no-invoker-iam-check --quiet; then
        warn "the server is running but only people of your organisation can open it. An administrator of your Google Cloud organisation must allow public Cloud Run services (organisation policies 'Domain restricted sharing' / 'run.managed.requireInvokerIam') for this project."
      fi
    fi
  fi
  ok "The server is running."
}

map_domain() {
  [[ -n "$DOMAIN" ]] || return 0
  step "connecting your own address https://$DOMAIN" \
    "Google must first know that you own $DOMAIN. Verify it once with: gcloud domains verify $DOMAIN  (it opens Google Search Console), then run this command again."
  if gq beta run domain-mappings describe --domain="$DOMAIN" --region="$REGION" --format='value(metadata.name)' >/dev/null; then
    ok "The address is already connected."
  else
    gc beta run domain-mappings create --service="$SERVICE" --domain="$DOMAIN" --region="$REGION" --quiet
  fi
  say "Add these records at the company where you bought $DOMAIN (its DNS settings):"
  gc beta run domain-mappings describe --domain="$DOMAIN" --region="$REGION" \
    --format='table(status.resourceRecords[].type:label=TYPE,status.resourceRecords[].name:label=NAME,status.resourceRecords[].rrdata:label=VALUE)' || true
  say "It can take from 15 minutes to a day before https://$DOMAIN works (Google creates its certificate)."
  say "Until then, use the Google address below."
}

check_health() {
  $DRY_RUN && return 0
  [[ -n "${SERVICE_URL:-}" ]] || return 0
  local attempt
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if curl -fsS -m 20 "$SERVICE_URL/health" >/dev/null 2>&1; then
      ok "The server answers at $SERVICE_URL"
      return 0
    fi
    sleep 5
  done
  warn "the server did not answer yet. It may still be starting; open the address below in a minute. If it shows an error, its log says why:"
  warn "    gcloud run services logs read $SERVICE --region $REGION --project $PROJECT --limit 50"
}

read_setup_code() {
  if $DRY_RUN; then
    print_cmd secrets versions access latest --secret="$SECRET_SETUP" --project="$PROJECT"
    printf 'XXXX-XXXX-XX (read from Secret Manager)'
    return 0
  fi
  gq secrets versions access latest --secret="$SECRET_SETUP" || true
}

show_setup_code() {
  choose_project
  load_state
  REGION="${REGION:-$DEFAULT_REGION}"
  local code url
  code="$(read_setup_code)"
  if $DRY_RUN; then
    url="https://$SERVICE-PROJECT_NUMBER.$REGION.run.app"
  else
    url="$(gq run services describe "$SERVICE" --region="$REGION" --format='value(status.url)' || true)"
  fi
  if [[ -z "$code" ]]; then
    fail "No setup code was found in project $PROJECT." \
      "Is this the project where the server was deployed? Run with --project YOUR-PROJECT-ID," \
      "or deploy first: bash deploy/gcp/deploy.sh"
  fi
  say "Dashboard address: ${url:-(not found in region $REGION; pass --region)}"
  say "Setup code:        ${BOLD}$code${RESET}"
  say "(The setup code is only needed once, to create the first administrator.)"
}

summary() {
  local code; code="$(read_setup_code)"
  local address="${SERVICE_URL:-}"
  local set_up=false
  if ! $DRY_RUN && [[ -n "$address" ]] \
    && curl -fsS -m 20 "$address/v1/server-info" 2>/dev/null | grep -q '"needsSetup":false'; then
    set_up=true
  fi
  local cost="about 10 to 15 US dollars"
  case "$DB_TIER" in
    db-f1-micro) ;;
    db-g1-small) cost="about 30 to 40 US dollars" ;;
    *) cost="more than with the smallest database machine (see the Cloud SQL pricing page)" ;;
  esac

  say ""
  say "${GREEN}${BOLD}Collect Earth Cloud is ready.${RESET}"
  say ""
  say "  Dashboard address:  ${BOLD}$address${RESET}"
  if [[ -n "$DOMAIN" ]]; then
    say "  Your own address:   https://$DOMAIN (once its DNS records are in place)"
  fi
  if $set_up; then
    say ""
    say "The first-time setup is already done: log in with your administrator account."
  else
    say "  Setup code:         ${BOLD}$code${RESET}"
    cat <<EOF

What to do now:
  1. Open the dashboard address in your browser.
  2. The first time, it asks for the setup code above and the user name and
     password of the server administrator (you). The code works only once:
     after that it is no longer needed.
  3. In "Server", choose who may create accounts and projects.
  4. Create your first project, upload the project file (.cep), plot files,
     and invite the people who collect data.
EOF
  fi
  cat <<EOF

Monthly cost: $cost, almost all of it the
database (Cloud SQL $DB_TIER). The server itself (Cloud Run) costs nothing or a
few cents while it is not busy. Prices change: see SELF-HOSTING.md for details.

To update to a new version later, open Cloud Shell and run the same command:
    cd $APP_DIR && bash deploy/gcp/deploy.sh
To see the setup code again:
    cd $APP_DIR && bash deploy/gcp/deploy.sh --show-setup-code
EOF
}

main() {
  if $DRY_RUN; then
    say "${BOLD}Dry run: nothing is created; these are the commands a real run would use.${RESET}"
    say "(Checks for existing things answer 'not found', so this is the first-install path.)"
  fi
  check_gcloud
  if $SHOW_SETUP_CODE; then
    show_setup_code
    return 0
  fi
  update_code
  choose_project
  choose_region
  confirm
  check_billing
  enable_apis
  create_database
  create_secrets
  create_service_account
  create_repository
  build_image
  deploy_service
  map_domain
  check_health
  summary
}

main; exit $?
