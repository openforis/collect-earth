<#
.SYNOPSIS
  Collect Earth Cloud: the Cloud Scheduler job that sends the weekly emails (Windows PowerShell or PowerShell 7).

.DESCRIPTION
  The same steps as "Weekly emails (optional)", step 3, of DEPLOY.md, for Windows:
    1. turns on Cloud Scheduler in the project;
    2. creates the service account the job calls as (ce-scheduler);
    3. tells the server which calls to accept (DIGEST_OIDC_AUDIENCE, DIGEST_OIDC_EMAIL);
    4. creates the job (every hour from 06:00 to 14:00 UTC on Mondays), or updates it when it exists.
  Safe to run again: what exists already is left as it is or updated, never created twice.
  Mail itself (SMTP_URL, MAIL_FROM, LINK_SECRET, PUBLIC_BASE_URL) must be set up first: see DEPLOY.md.

  Run it with gcloud installed and logged in (gcloud auth login), from this folder:
    powershell -ExecutionPolicy Bypass -File .\setup-weekly-emails.ps1 -Project my-project -Region europe-west1 -Address https://cloud.example.org
  -ExecutionPolicy Bypass lets this one script run where Windows blocks scripts by default; it changes no setting.
  -RunNow also runs the job once at the end, which sends the weekly emails that are due now.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\setup-weekly-emails.ps1 -Project ce-cloud-prod -Region europe-west1 -Address https://cloud.collectearth.org
#>
param(
  [Parameter(Mandatory = $true)] [string] $Project,
  # The region of the Cloud Run service (gcloud run services list --project=<PROJECT> shows it)
  [Parameter(Mandatory = $true)] [string] $Region,
  # The server's public address, as in PUBLIC_BASE_URL (no / at the end)
  [Parameter(Mandatory = $true)] [string] $Address,
  [switch] $RunNow
)

# gcloud's messages go to stderr: they must not stop the script; each step checks gcloud's exit code instead
$ErrorActionPreference = "Continue"

$Service  = "collect-earth-cloud"
$Job      = "ce-weekly-digest"
$SaName   = "ce-scheduler"
$Account  = "$SaName@$Project.iam.gserviceaccount.com"
$Endpoint = "$($Address.TrimEnd('/'))/v1/internal/digest"

function Step([string] $text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function Check([string] $what) {
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Stopped: $what failed (see the message above)." -ForegroundColor Red
    exit 1
  }
}

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  Write-Host "gcloud is not installed or not on the PATH: https://cloud.google.com/sdk/docs/install" -ForegroundColor Red
  exit 1
}

Step "Cloud Scheduler on in $Project"
gcloud services enable cloudscheduler.googleapis.com --project=$Project
Check "turning on Cloud Scheduler"

Step "Service account $Account"
gcloud iam service-accounts describe $Account --project=$Project *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host "already there"
} else {
  gcloud iam service-accounts create $SaName --project=$Project --display-name="Collect Earth Cloud weekly emails"
  Check "creating the service account"
}

Step "The server accepts the job's calls ($Service, $Region)"
gcloud run services update $Service --region=$Region --project=$Project `
  --update-env-vars="DIGEST_OIDC_AUDIENCE=$Endpoint,DIGEST_OIDC_EMAIL=$Account"
Check "updating the Cloud Run service"

Step "Job $Job (Mondays, every hour from 06:00 to 14:00 UTC)"
$common = @(
  "--project=$Project", "--location=$Region",
  "--schedule=0 6-14 * * 1", "--time-zone=Etc/UTC",
  "--uri=$Endpoint", "--http-method=POST",
  "--oidc-service-account-email=$Account", "--oidc-token-audience=$Endpoint",
  "--message-body={}", "--attempt-deadline=900s"
)
gcloud scheduler jobs describe $Job --project=$Project --location=$Region *> $null
if ($LASTEXITCODE -eq 0) {
  gcloud scheduler jobs update http $Job @common "--update-headers=content-type=application/json"
  Check "updating the job"
} else {
  gcloud scheduler jobs create http $Job @common "--headers=content-type=application/json"
  Check "creating the job"
}

if ($RunNow) {
  Step "Running the job once"
  gcloud scheduler jobs run $Job --project=$Project --location=$Region
  Check "running the job"
  Write-Host "The service's log shows 'digest: run ended' with the counts."
}

Write-Host ""
Write-Host "Done. Check: Cloud Scheduler > $Job > Force run; the log of $Service shows 'digest: run ended'." -ForegroundColor Green
