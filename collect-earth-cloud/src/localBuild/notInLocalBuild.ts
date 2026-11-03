// The stand-ins of the local bundle (scripts/build-local.mjs) for the modules only the cloud
// uses: the Postgres store and its migrations, the AI client and SMTP mail. The local mode
// never calls them; anything else that does gets this error instead of a missing package.

export function notInLocalBuild(what: string): Error {
  return new Error(`${what} is not part of the local build (dist/server.mjs, LOCAL_MODE=1): run the server from its sources (npm start) for it`);
}
