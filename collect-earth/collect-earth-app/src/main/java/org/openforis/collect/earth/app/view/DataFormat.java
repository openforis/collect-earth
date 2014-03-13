package org.openforis.collect.earth.app.view;

enum DataFormat{
	ZIP_WITH_XML(new String[]{"zip"}),CSV(new String[]{"csv"}),FUSION(new String[]{"csv"}),COLLECT_COORDS(new String[]{"csv","ced"}); //$NON-NLS-1$ //$NON-NLS-2$ //$NON-NLS-3$

	private String[] fileExtension;
	private DataFormat(String[] fileExtension) {
		this.fileExtension = fileExtension;
	}

	public String[] getFileExtension() {
		return fileExtension;
	}
}