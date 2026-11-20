REQUIREMENTS

Collect Earth is a visual interpretation tool. It shows the plots in Google Earth Web and in other imagery sources (ESRI Wayback, Planet, Collect Earth Explorer, Earth Map) inside a web browser.


A BROWSER: GOOGLE CHROME, MICROSOFT EDGE OR MOZILLA FIREFOX
Keep one of them installed and up to date. Collect Earth opens its own browser windows; the browser can be chosen in Settings.
Google Earth Pro is no longer needed.


CREATING A SURVEY
Create your survey and project on Collect Earth Cloud: https://cloud.collectearth.org
How to do it, with guides and examples: https://collectearth.org


THE SAMPLING DESIGN (GRID OF PLOTS)
The easiest way to generate a systematic or random grid of plots is this tool:
https://collectearth.users.earthengine.app/view/collect-earth-grid-generator


PLOT COORDINATES: WGS84 LATITUDE AND LONGITUDE ONLY
The latitude and longitude of the plots in the plot file must be WGS84 latitude and longitude in decimal degrees
(EPSG:4326), for example -1.2921 and 36.8219: the latitude between -90 and 90, the longitude between -180 and 180.
Collect Earth takes no other coordinate system (UTM, a national grid...) and converts none, because Google Earth Web and
the imagery it opens use WGS84 degrees. Convert a plot file in another system first (in QGIS, for instance), and set the
survey's coordinate system to EPSG:4326 in the survey designer.


WORKING AS A TEAM
A coordinator can run a project on a Collect Earth Cloud server: the team joins it from Collect Earth (Join cloud project) and each person receives the plots assigned to them.


OPEN FORIS WEBSITE
Documentation and downloads: https://www.openforis.org/tools/collect-earth.html
What changed in each version: https://github.com/openforis/collect-earth/blob/master/collect-earth/CHANGELOG.md
