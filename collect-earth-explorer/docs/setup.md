# One-time cloud setup

Run these once, from the repo root, with `firebase-tools` and `gcloud` installed and
logged in. Every command works in PowerShell and Git Bash alike.

The app lives in the existing `collectearth` project, next to the collect-earth-cloud
Cloud Run service. Billing is already linked there. To use another project, replace
`collectearth` here and in `.firebaserc`, `web/.env.production` and the README.

Earth Engine runs as the project's own service account,
`ce-explorer@collectearth.iam.gserviceaccount.com`, so EE usage is billed to
`collectearth` (which is registered for Earth Engine).

Your account needs more than Editor: Datastore Owner (step 3) and Cloud Functions
Admin (the first deploy makes the function public).

## 0. Tools and login

    npm install -g firebase-tools
    firebase login
    gcloud auth login

## 1. Add Firebase to the project

    firebase projects:addfirebase collectearth

## 2. Enable the APIs

    gcloud services enable cloudfunctions.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com run.googleapis.com eventarc.googleapis.com secretmanager.googleapis.com firestore.googleapis.com firebasehosting.googleapis.com --project collectearth

## 3. Firestore database and cache TTL

The project's `(default)` database is in Datastore mode and belongs to other
services, so the cache uses its own database, `explorer` (named in
`functions/cache.js` and `firebase.json`), in the function's region. Creating a
database needs the Owner or Datastore Owner role; Editor is not enough.

    gcloud firestore databases create --database=explorer --location=europe-west1 --type=firestore-native --project collectearth
    gcloud firestore fields ttls update expiresAt --collection-group=cache --enable-ttl --database=explorer --project collectearth

The TTL policy purges expired cache documents automatically (the code ignores
expired documents but never deletes them).

## 4. Earth Engine service account and the EE_KEY secret

    gcloud iam service-accounts create ce-explorer --display-name="Collect Earth Explorer (Earth Engine)" --project collectearth
    gcloud projects add-iam-policy-binding collectearth --member="serviceAccount:ce-explorer@collectearth.iam.gserviceaccount.com" --role="roles/serviceusage.serviceUsageConsumer" --condition=None
    gcloud projects add-iam-policy-binding collectearth --member="serviceAccount:ce-explorer@collectearth.iam.gserviceaccount.com" --role="roles/earthengine.writer" --condition=None
    gcloud iam service-accounts keys create "C:path	ocollectEarthExplorer.json" --iam-account=ce-explorer@collectearth.iam.gserviceaccount.com
    firebase functions:secrets:set EE_KEY --data-file "C:path	ocollectEarthExplorer.json" --project collectearth

`earthengine.writer` is needed to create map tiles; `viewer` only allows
computations. The key never enters git. Firebase grants the function's runtime
service account access to the secret at deploy time.

## 5. Local key for the emulator and live tests

`functions/.secret.local` must be a single unquoted line, `EE_KEY={...}`. This
command writes it from the same JSON file (it is git-ignored):

    node -e "const fs=require('fs');const k=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));fs.writeFileSync('functions/.secret.local','EE_KEY='+JSON.stringify(k)+'\n')" "C:\path\to\collectEarthExplorer.json"

## 6. Verify, then deploy

    cd functions && npm install && cd ../web && npm install && cd ..
    EE_LIVE=1 npm --prefix functions run test:live     # 21 live Earth Engine tests
    firebase emulators:start                           # http://localhost:5000/?geoJson=...
    npm run deploy
    firebase functions:artifacts:setpolicy --location europe-west1   # once, if the first deploy asks for a cleanup policy
    curl https://europe-west1-collectearth.cloudfunctions.net/api/api/health
    curl https://collectearth.web.app/api/health

Then point Collect Earth at `https://collectearth.web.app/?geoJson=...&startTime=...&endTime=...&plot_id=...`.
