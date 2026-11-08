#!/usr/bin/env bash
# Collect Earth Cloud — long-term copies of the database, beside Cloud SQL's own backups (DEPLOY.md, "Backups").
#
# Cloud SQL keeps 7 daily backups and 7 days of point-in-time recovery: a mistake noticed after a week is beyond them.
# This script adds a monthly copy kept a year (by default), in a Cloud Storage bucket of the same project and region:
#   1. creates the bucket (no public access, versions kept: each month's copy replaces the last, which stays as an
#      older version until it is older than --keep-months);
#   2. lets the database server write to it;
#   3. makes a first copy now;
#   4. with --schedule, asks Cloud Scheduler to make one on the 1st of every month at 03:00 UTC.
# Run it again at any time: what exists is kept. It changes nothing in the server or its database.
#
# NOT YET RUN: written without access to Google Cloud. Check its first run (the bucket, the first copy, the
# scheduler job) in the console, and restore a copy once, as DEPLOY.md's restore drill says.
#
#   deploy/gcp/monthly-backups.sh --project <PROJECT> [--region europe-west1] [--keep-months 12] [--schedule]
set -Eeuo pipefail

SQL_INSTANCE=ce-cloud-db
DB_NAME=collect_earth_cloud
SCHEDULER_SA=ce-backup-scheduler
PROJECT=""
REGION=europe-west1
KEEP_MONTHS=12
SCHEDULE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --keep-months) KEEP_MONTHS="$2"; shift 2 ;;
    --schedule) SCHEDULE=true; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done
[[ -n "$PROJECT" ]] || { echo "Give the Google Cloud project: --project <PROJECT>" >&2; exit 2; }
[[ "$KEEP_MONTHS" =~ ^[0-9]+$ && "$KEEP_MONTHS" -ge 1 ]] || { echo "--keep-months must be a whole number of months" >&2; exit 2; }
command -v gcloud >/dev/null || { echo "gcloud is needed (Cloud Shell has it)" >&2; exit 2; }

BUCKET="gs://${PROJECT}-ce-backups"
COPY="$BUCKET/${SQL_INSTANCE}-monthly.sql.gz"
KEEP_DAYS=$((KEEP_MONTHS * 31))

echo "1. The bucket $BUCKET (region $REGION), copies kept $KEEP_MONTHS months"
if ! gcloud storage buckets describe "$BUCKET" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud storage buckets create "$BUCKET" --project="$PROJECT" --location="$REGION" \
    --uniform-bucket-level-access --public-access-prevention
fi
gcloud storage buckets update "$BUCKET" --versioning
LIFECYCLE="$(mktemp)"
trap 'rm -f "$LIFECYCLE"' EXIT
# The current copy stays; an older one goes once it has been an older version for that many days
cat >"$LIFECYCLE" <<EOF
{"rule": [{"action": {"type": "Delete"}, "condition": {"isLive": false, "daysSinceNoncurrentTime": $KEEP_DAYS}}]}
EOF
gcloud storage buckets update "$BUCKET" --lifecycle-file="$LIFECYCLE"

echo "2. The database server may write to it"
SQL_SA="$(gcloud sql instances describe "$SQL_INSTANCE" --project="$PROJECT" --format='value(serviceAccountEmailAddress)')"
gcloud storage buckets add-iam-policy-binding "$BUCKET" --member="serviceAccount:$SQL_SA" --role=roles/storage.objectAdmin >/dev/null

echo "3. A first copy now (a few minutes; the server keeps working meanwhile)"
gcloud sql export sql "$SQL_INSTANCE" "$COPY" --database="$DB_NAME" --project="$PROJECT"

if [[ "$SCHEDULE" == true ]]; then
  echo "4. A copy on the 1st of every month, 03:00 UTC (Cloud Scheduler)"
  gcloud services enable cloudscheduler.googleapis.com --project="$PROJECT"
  SA="$SCHEDULER_SA@$PROJECT.iam.gserviceaccount.com"
  if ! gcloud iam service-accounts describe "$SA" --project="$PROJECT" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$SCHEDULER_SA" --project="$PROJECT" --display-name="Collect Earth Cloud monthly backup"
  fi
  # Exporting needs cloudsql.instances.export: Cloud SQL Admin has it. A custom role with that one permission is
  # narrower, for whoever prefers to make it and give it to this account instead.
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role=roles/cloudsql.admin --condition=None >/dev/null
  BODY="{\"exportContext\": {\"fileType\": \"SQL\", \"uri\": \"$COPY\", \"databases\": [\"$DB_NAME\"]}}"
  URL="https://sqladmin.googleapis.com/v1/projects/$PROJECT/instances/$SQL_INSTANCE/export"
  if gcloud scheduler jobs describe ce-monthly-backup --location="$REGION" --project="$PROJECT" >/dev/null 2>&1; then
    gcloud scheduler jobs update http ce-monthly-backup --location="$REGION" --project="$PROJECT" \
      --schedule="0 3 1 * *" --time-zone=UTC --uri="$URL" --http-method=POST --message-body="$BODY" \
      --update-headers=Content-Type=application/json --oauth-service-account-email="$SA"
  else
    gcloud scheduler jobs create http ce-monthly-backup --location="$REGION" --project="$PROJECT" \
      --schedule="0 3 1 * *" --time-zone=UTC --uri="$URL" --http-method=POST --message-body="$BODY" \
      --headers=Content-Type=application/json --oauth-service-account-email="$SA"
  fi
fi

echo "Done. The copies: gcloud storage ls --all-versions $COPY"
