package org.openforis.collect.earth.sampler.utils;

import java.io.File;


public class Strata {

	private String stratum;
	private Integer fileNumber;
	private File outputFile;
	
	public Strata(String stratum, Integer fileNumber) {
		super();
		this.stratum = stratum;
		this.fileNumber = fileNumber;
	}
	public String getStratum() {
		return stratum;
	}
	public void setStratum(String stratum) {
		this.stratum = stratum;
	}
	public Integer getFileNumber() {
		return fileNumber;
	}
	public void setFileNumber(Integer fileNumber) {
		this.fileNumber = fileNumber;
	}
	@Override
	public int hashCode() {
		final int prime = 31;
		int result = 1;
		result = prime * result
				+ ((fileNumber == null) ? 0 : fileNumber.hashCode());
		result = prime * result + ((stratum == null) ? 0 : stratum.hashCode());
		return result;
	}
	@Override
	public boolean equals(Object obj) {
		if (this == obj)
			return true;
		if (obj == null)
			return false;
		if (getClass() != obj.getClass())
			return false;
		Strata other = (Strata) obj;
		if (fileNumber == null) {
			if (other.fileNumber != null)
				return false;
		} else if (!fileNumber.equals(other.fileNumber))
			return false;
		if (stratum == null) {
			if (other.stratum != null)
				return false;
		} else if (!stratum.equals(other.stratum))
			return false;
		return true;
	}
	
	public String getFileName() {
		// For the cases when there are / in the name, not allowed as DOS File names. 
		String escapedStratum = stratum.replaceAll("/", "_");
		escapedStratum = escapedStratum.replaceAll("\\\\", "_");
		if( fileNumber == null ){
			return escapedStratum + ".csv";
		}else{
			return escapedStratum + "_" +  (fileNumber+1 ) + ".csv"; // make user that the first file is one and not zero
		}
	}
	public File getOutputFile() {
		return outputFile;
	}
	public void setOutputFile(File outputFile) {
		this.outputFile = outputFile;
	}
	
	
	
	
}
