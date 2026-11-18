# Collect's Collect Earth templates

`collect_earth.idm.xml` (basic), `collect_earth_ipcc.idm.xml` and `collect_earth_multipurpose.idm.xml` are the
Collect Earth templates of Collect's Survey Designer, copied unchanged (CRLF line endings included) from
`collect-server/src/main/resources/org/openforis/collect/designer/templates/` of
[openforis/collect](https://github.com/openforis/collect) (MIT licence, Open Foris).

New projects start from them in the dashboard ("Design the survey here", `src/survey/templates.ts`: the blank survey
is the basic one without its demonstration questions), so they ship with the server (the `Dockerfile` copies this
folder). They are also the most complex surveys Collect Earth projects use, and the survey designer's tests run on
them (`test/surveyTree.test.ts`): read and written back byte for byte, then changed. Keep them byte-exact: do not let
an editor or `core.autocrlf` change their line endings.
