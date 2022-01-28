Collect Earth - Augmented Visual Interpretation
=======

## What is Collect Earth?

Collect Earth is a tool that enables data collection through Google Earth. In conjunction with Google Earth, Bing Maps and Google Earth Engine, users can analyze high and very high resolution satellite imagery for a wide variety of purposes, including :
 
  - Support multi-phase National Forest Inventories
  - Land Use, Land Use Change and Forestry (LULUCF) assessments
  - Monitoring agricultural land and urban areas
  - Validation of existing maps
  - Collection of spatially explicit socio-economic data
  - Quantifying deforestation, reforestation and desertification
 
Its user friendliness and smooth learning curve make it a perfect tool for performing fast, accurate and cost-effective assessments. It is highly customizable for the specific data collection needs and methodologies.
 
The data gathered through Collect Earth is exportable to commonly used formats and can also be exported to Saiku, a tool that facilitates data analysis.

## Where to download the installer!

If you are not interested in the code but rather on the Collect Earth features you might want to run it right away!
[Go to our website](http://www.openforis.org/tools/collect-earth.html) and download the installer directly there. There are versions for WIndows, Mac OS X and Linux 32 and 64. 

## If you have a question!

Please register into our [community support forum](http://www.openforis.org/support) and raise your question or feature request there. 

## Importing in Eclipse

- Import the project using the File->New->Project->Maven->Check out Maven Projects from SCM
- You need to have the M2E Git connector (click on the m2e Marketplace in the dialog and install the "m2e-egit" connector from there if you don't have it already)
- Set the SCM url ``https://github.com/openforis/collect-earth.git`` and follow the import wizard!

## Running from Eclipse (or another IDE)

You can run Collect Earth directly through the IDE. In Eclipse you can use Run->Run Configurations... and then create a new "Java application" configuration.
In the project set `collect-earth-app` and as Main class set `org.openforis.collect.earth.app.desktop.EarthApp`

### Code Quality through SonarQube

The code quality of the repository can be inspected here  : https://sonarcloud.io/project/overview?id=openforis_collect-earth

## Contact

Contact us through GitHub (@herrtunante) or openforisinitiative at gmail !

## License

Collect Earth and the rest of the Open Foris tools follow the MIT License, meaning that you can do anything you want with the code! Of course we appreciate references to our project www.openforis.org
