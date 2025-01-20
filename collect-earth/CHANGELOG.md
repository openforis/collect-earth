# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- 

### Added
- Announcement feature to keep users informed

### Fixed
- 

## [1.21.8] - 2024-12-30

### Changed
- Updated versions of libraries for Chrome/Firefox
- Connection to Planet daily imagery service has been fixed

### Added
- Export Sampling Error Excel file inside the GHGi LULUCF package

### Fixed
- Bug when CE started in the new Mac iOS for arm architecture
- Bug when Firefox not installed and Collect Earth installed fresh (browser windows not opening)

## [1.20.7] - 2023-07-06

### Changed
- Updated versions of libraries for Chrome/Firefox
- Connection to Planet daily imagery service has been fixed

### Added


## [1.20.6] - 2023-07-06

### Changed
- Changed version of JRE in Collect Earth to OpjenJDK 11.0.19+7

### Added
- Export data to KML
- Set start and end months for Planet NICFI imagery (on the Properties dialog and the local properties file)
- Set start and end dates for the GEE App charts (on the Properties dialog and the local properties file)
- Export button added on the main CE window


## [1.15.08] - 2023-04-15

### Fixed
- KML Import to open in GE working.
- Updated Selenium to support latest versions of Chrome/Firefox.


## [1.14.19] - 2022-11-17

### Fixed
- SAIKU not starting from the CE menu (bug introduced in version 1.14.17 ) 

## [1.14.17] - 2022-09-15

### Added
- Export SAIKU stand-alone tool as a ZIP file.

## [1.14.15] - 2022-06-28

### Fixed
- Code attributes linked to calculated attribute parents not updating in the interface.
### Changed
- Earth Map integration: No more necessary to login (using embed=true parameter in URL).


## [1.14.12] - 2022-03-31


### Fixed
- Plots showing up with weird shapes in Google Earth.


## [1.14.9] - 2022-03-23

### Changed
- Updated Collect and Selenium-web updater libraries.

## [1.14.8] - 2022-02-03

### Changed
- Mac OS X Monterey fixes.

## [1.14.6] - 2022-01-13

### Changed
- Update to latest Log4J ( so far no risk has been detected of Log4Shell but just a precaution)
- Fix for Mac OS X Monterey installer.


## [1.14.5] - 2021-12-18

### Removed
- Safari not supported anymore due to persistent issues with maintenance.


## [1.14.4] - 2021-12-9

### Added
-

### Changed
 - Automatic update notification is working again


## [1.14.3] - 2021-12-9

### Added
-

### Changed
 - CSV divider tool issue with UTF-8 charset fixed
 - Saiku starts faster when using very large databases


## [1.14.1] - 2021-12-01

### Added
-

### Changed
 - Allow for daily images selection in CE/Planet Daily (API Key) integration

## [1.14.0] - 2021-11-01

### Added
- Support for Edge and Safari

### Changed
 - Export dialog labels (to clarify that CSV export is only for data visualization and not to share with other Collect Earth users)
 - Selenium driver loading, so that the users never have to worry again about the version of the browser installed in their computer.

### Removed
- Integrations with GEE Playground, Timelapse and Streetview that is already deprecated.

## [1.13.05] - 2021-09-17

### Changed
 - Support latest Chrome version (93)
 - Remove class linking exceptions
 - Improved loading times for Properties dialog


## [1.13.03] - 2021-06-08

### Changed
 - Support latest Chrome version
 - Remove memory leaks

## [1.13.02] - 2021-05-23

### Changed
 - Bug fix for system memory error when loading very large table
 - Update to latest version of Open CSV and Collect

## [1.13.00] - 2021-04-12

### Changed
 - Improved Mac osx installer

## [1.12.17] - 2021-03-30

### Changed
 - Added Google Analytics logging


## [1.12.16] - 2021-03-19

### Changed
 - Updated plugins for Mozilla Firefox and Google Chrome to use the very latest versions as of today

## [1.12.15] - 2021-03-11

### Changed
 - Hosting moved from Open Foris Nexus to Sonatype

## [1.12.11] - 2021-03-05

### Changed
 - Minor improvement for filtering Planet daily imagery

## [1.12.10] - 2021-03-04

### Changed
 - Improved access to Planet Daily imagery

## [1.12.7] - 2020-12-07

### Changed
 - FIXED: Planet integration with daily imagery
 - Mac OSX dock icon switchd to PNG format

## [1.12.6] - 2020-11-24

### Changed
 - Open Earth Map integration with more meaningful default products
 - Update Chromedriver to be compatible with Chrome version 87
 - Improved integration with Earth Map

## [1.12.5] - 2020-11-02

### Added
 - Possibility to use Well Known Text (WKT) or GeoJson for drawing polygons (on top of the current support to KML polygons)

### Changed
 - Planet : adapted integration to access the biannual mosaics

## [1.12.4] - 2020-10-22

### Changed
 - Planet : allow access with daily imagery API Key or usign the NICFI provided monthly images

## [1.12.3] - 2020-10-15

### Changed
 - Planet API Key improvements

## [1.12.0] - 2020-10-14

### Added
 - Access to the NICFI procured Planet monthly basemaps using a side-by-side mosaic comparison tool

### Removed
 - Planet Maps daily imagery access (not working any more due to FAO-Planet agreement finishing in September 2020)

## [1.11.00] - 2020-9-30

### Changed
 - This version prepares the new users (and updates old ones) to be able to use the updating of Collect Earth through the new HTTPS enabled repositories.

## [1.10.19] - 2020-9-28

### Added
 - Updated AutoUpdater to support SSL connection in preparation for the migration to Sonatype Repositories


## [1.10.18] - 2020-8-30

### Changed
 - Update to use latest version of Chrome 85 and Firefox 80
 - Update all libraries to their most up to date versions

## [1.10.17] - 2020-5-22

### Added
 - Support to Earth Map integration

### Changed
- Updated Chromedriver to be compatible with Chrome 83
- New Demo Survey that guides the user through the plots with a connection to a HTML/PowerPoint slides.

## [1.10.16] - 2020-4-30

### Changed
- Added a message with the names of the key attributes when importing CSV (increased usability of hte data update)
- Added info to the installer README
- Update CEP file in the installer

## [1.10.16] - 2020-4-6

### Changed
- Demo survey now opens the GEE App rather than a GEE Code Editor

## [1.10.15] - 2020-4-6

### Changed
- Fixed the hesagon and circle shape plot layout generation.
- Updater updated so that the chromedriver.exe processes are stoped and the updater might replace the file
- Installer is now deleting the java and tmp folders so that there are no issues with the JRE versions

## [1.10.14] - 2020-3-30

### Changed
- Updated to version 3.26.6 of Collect.

## [1.10.12] - 2020-2-27

### Changed
- Refresh the view in SecureWatch when it is locked

## [1.10.11] - 2020-2-13

### Changed
- Fixed installer for the Mac OS X

## [1.10.10] - 2020-2-11

### Changed
- Refresh the view in SecureWatch when it is locked

## [1.10.9] - 2020-2-10

### Added
- Added full support for Secure Watch

## [1.10.8] - 2020-2-10

### Changed
- Fixed support for Chrome version 80

## [1.10.6] - 2020-2-5

### Changed
- Planet Imagery improvements

## [1.10.5] - 2020-2-3

### Changed
- Added access to Rapid Eye imagery for the Planet integration

## [1.10.4] - 2020-1-31

### Changed
- Fixed JRE issue when installing new versions of Windows and MacOS

## [1.10.0] - 2020-1-29

### Changed
- Multiple bug fixes when opening SecureWatch and Planet
- Added the JRE to the installers that had a problem in the previous version

## [1.10.0] - 2020-1-29

### Added
- Added support for Maxar SecureWatch imagery

### Changed
- Updated the JRE used on the installer from Oracle 1.8.1_121 of AdoptOpenJDK 1.8.0_232 with
- Updated to latest version of Collect and syncronized libraries to use the same versions ( Spring and others)
- Improved Planet integration


## [1.9.1] - 2019-12-13

### Added
- Added support for Planet Maps imagery

## [1.9.0] - 2019-11-27

### Added
- Turkish translations for the GUI
- Support for Mac OS X - Catalina

## [1.8.8] - 2019-10-24

### Changed
- Updated ChromeDriver to support the newest version of Chrome ( 78 )
- Updated to latest version of Jetty server
- Small bug fixes

## [1.8.7] - 2019-08-02

### Changed
- Updated ChromeDriver to support the newest version of Chrome ( 76 )

## [1.8.4] - 2019-06-06

### Changed
- Fix bug that did not allow the user to update the values of already stored plots (due to validation issues preventing the write to DB)

## [1.8.2] - 2019-06-03

### Changed
- Fix of CSV updates not showing progress on large CSV files
- Fix of switch between DB types requiring a full Collect Earth restart
- Updated Collect core (3.24.23) version to fix bug when switching from single to multiple code list attributes.

## [1.8.1] - 2019-05-06

### Added
- Added option to use the ID of the plot as one of the parameters in the extra_map_url URL i.e. http://openthiswindow.com?lat=LATITUDE&long=LONGITUDE&id=PLOT_ID
- Added support to the new Survey Guide PDF document file. If a Survey Guide file is added to the survey it can be opened directly within the Help menu

### Changed
- Updated Chromedriver to be compatible with Chrome version 74
- Fixed the progress monitor not working when exporting data (CSV or XML)


## [1.8.0] - 2019-04-12

### Added
- Added the Changelog mechanism to keep track of changes to the code
- Added a link to this Change Log from the About dialog
- Added a button to access the Properties directly in the dialog

### Changed
- Fix exceptions when no file is chosen in the "Find Missing Plots in Database" dialog
- Operator name is updated automatically when the user finished typing on the text field

### Removed
- Removed the unnecessary Quit button from the main windows
- Operator name update button


## [1.7.12] - 2019-03-29
### Added
- TODO

### Changed
- Updated to last version of Collect Core (3.24.15) that fixes the issue with calculated attributes not using the right calculation chain.

### Removed
- TODO
