package org.openforis.collect.earth.app.view;

import java.io.File;

import javax.swing.filechooser.FileFilter;

/**
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class FileTypeFilter extends FileFilter {

	private String extension;
	private String description;

	public FileTypeFilter(String extension, String description) {
		this.extension = extension;
		this.description = description;
	}

	@Override
	public boolean accept(File file) {
		if (file.isDirectory()) {
			return true;
		}
		return file.getName().toLowerCase().endsWith(extension);
	}

	@Override
	public String getDescription() {
		return description + String.format(" (*%s)", extension);
	}
}