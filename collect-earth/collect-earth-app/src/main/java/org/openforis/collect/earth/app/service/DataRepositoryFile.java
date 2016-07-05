package org.openforis.collect.earth.app.service;

import java.io.File;

public class DataRepositoryFile {
	
	File repositoryFile;
	String name;
	String comment;
	long savedOn;
	
	public File getRepositoryFile() {
		return repositoryFile;
	}
	public void setRepositoryFile(File repositoryFile) {
		this.repositoryFile = repositoryFile;
	}
	public String getName() {
		return name;
	}
	public void setName(String name) {
		this.name = name;
	}
	public String getComment() {
		return comment;
	}
	public void setComment(String comment) {
		this.comment = comment;
	}
	public long getSavedOn() {
		return savedOn;
	}
	public void setSavedOn(long savedOn) {
		this.savedOn = savedOn;
	}
	

}
