// Every call the dashboard makes to the Collect Earth Cloud server, one file per area. Pages import them from here.
//
// The dashboard is built and shipped with the server, so it never talks to another version of it: each answer's
// type is the server's own (its src/wire/ folder), and the answer is used as it comes. A field the server renames
// fails the typecheck. A page left open across an upgrade offers to reload (../newVersion.ts).
//
// transport.ts holds how the calls are made (request, send, upload): only its errors are for the pages.

export { ApiError, apiErrorFrom, asStatus, errorMessageKey, NETWORK_ERROR, safeUrl, setUnauthorizedHandler, type Progress } from "./transport";
export * from "./common";
export * from "./account";
export * from "./projects";
export * from "./plotFiles";
export * from "./progress";
export * from "./people";
export * from "./quality";
export * from "./review";
export * from "./map";
export * from "./data";
export * from "./activity";
export * from "./training";
export * from "./server";
