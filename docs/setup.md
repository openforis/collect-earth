# One-time cloud setup

Run these once, from the repo root, with `firebase-tools` and `gcloud` installed and
logged in. Every command works in PowerShell and Git Bash alike. Replace
`ce-earth-viewer` everywhere if that project id is already taken (ids are global);
then also update `.firebaserc`, `web/.env.production` and the README.

The Earth Engine key is the **existing Earth Map service account key**. The viewer
runs under that account, so EE compute and quota are shared with Earth Map and the
new Firebase project does not need its own Earth Engine registration. See the last
section if you prefer to bill EE usage to the new project instead.

## 0. Tools and login

    npm install -g firebase-tools
    firebase login
    gcloud auth login

## 1. Create the project and add Firebase

    gcloud projects create ce-earth-viewer --name="CE Earth Viewer"
    firebase projects:addfirebase ce-earth-viewer
    gcloud config set project ce-earth-viewer
    firebase use ce-earth-viewer

## 2. Blaze plan (billing)

Cloud Functions 2nd gen requires billing.

    gcloud billing accounts list
    gcloud billing projects link ce-earth-viewer --billing-account=XXXXXX-XXXXXX-XXXXXX

## 3. Enable the APIs

    gcloud services enable cloudfunctions.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com run.googleapis.com eventarc.googleapis.com secretmanager.googleapis.com firestore.googleapis.com cloudresourcemanager.googleapis.com

## 4. Firestore database and cache TTL

The function runs in `europe-west1`; keep Firestore in the same region.

    gcloud firestore databases create --location=europe-west1
    gcloud firestore fields ttls update expiresAt --collection-group=cache --enable-ttl

The TTL policy purges expired cache documents automatically (the code ignores
expired documents but never deletes them).

## 5. Store the Earth Map service-account key as the EE_KEY secret

Point `--data-file` at the Earth Map key JSON you already have. The key never
enters git.

    firebase functions:secrets:set EE_KEY --data-file "C:\path\to\earth-map-service-account.json" --project ce-earth-viewer

Firebase grants the function's runtime service account access to the secret at
deploy time; nothing else to configure.

## 6. Local key for the emulator and live tests

`functions/.secret.local` must be a single unquoted line, `EE_KEY={...}`. This
command writes it from the same JSON file (it is git-ignored):

    node -e "const fs=require('fs');const k=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));fs.writeFileSync('functions/.secret.local','EE_KEY='+JSON.stringify(k)+'\n')" "C:\path\to\earth-map-service-account.json"

## 7. Verify, then deploy

    cd functions && npm install && cd ../web && npm install && cd ..
    EE_LIVE=1 npm --prefix functions run test:live     # 21 live Earth Engine tests
    firebase emulators:start                           # http://localhost:5000/?geoJson=...
    npm run deploy
    curl https://europe-west1-ce-earth-viewer.cloudfunctions.net/api/api/health
    curl https://ce-earth-viewer.web.app/api/health

Then point Collect Earth at `https://ce-earth-viewer.web.app/?geoJson=...&startTime=...&endTime=...&plot_id=...`.

## Optional: bill Earth Engine usage to the new project

By default the backend initialises Earth Engine with the key's own `project_id`,
i.e. the Earth Map project. To run EE requests under `ce-earth-viewer` instead:

1. Register `ce-earth-viewer` for Earth Engine at
   https://console.cloud.google.com/earth-engine (commercial or non-commercial,
   as for Earth Map) and enable the API:

       gcloud services enable earthengine.googleapis.com

2. Let the Earth Map service account consume this project's quota:

       gcloud projects add-iam-policy-binding ce-earth-viewer --member="serviceAccount:<earth-map-sa>@<earth-map-project>.iam.gserviceaccount.com" --role="roles/serviceusage.serviceUsageConsumer"

3. Tell the function which project to use (`functions/.env`, committed, no secret):

       EE_PROJECT=ce-earth-viewer

Redeploy afterwards. Without step 3 nothing changes.
