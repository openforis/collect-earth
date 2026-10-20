package org.openforis.collect.earth.app.view;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import javax.swing.Icon;
import javax.swing.UIManager;
import javax.swing.filechooser.FileSystemView;

/**
 * A FileSystemView that works with plain files only and never asks the operating system shell about them.
 *
 * The default view of Windows turns every file it lists into a sun.awt.shell.ShellFolder, whatever the
 * FileChooser.useShellFolder property says, and resolves shortcuts through the shell : a broken one - a .lnk in the Recent
 * folder whose target is gone - makes it throw InternalError "Unable to bind ... to parent". This view is what the file
 * choosers fall back to when that happens (see ShellFolderFallback). The price is the Windows icons, display names and
 * virtual folders such as "This PC".
 */
class PlainFileSystemView extends FileSystemView {

	static final PlainFileSystemView INSTANCE = new PlainFileSystemView();

	@Override
	public File[] getFiles(File dir, boolean useFileHiding) {
		File[] children = dir == null ? null : new File(dir.getPath()).listFiles();
		if (children == null) {
			return new File[0];
		}
		List<File> files = new ArrayList<>(children.length);
		for (File child : children) {
			if (!useFileHiding || !child.isHidden()) {
				files.add(child);
			}
		}
		return files.toArray(new File[0]);
	}

	@Override
	public File[] getRoots() {
		return File.listRoots();
	}

	@Override
	public boolean isRoot(File f) {
		return isFileSystemRoot(f);
	}

	@Override
	public boolean isFileSystemRoot(File dir) {
		return dir != null && dir.getParentFile() == null && dir.isAbsolute();
	}

	@Override
	public File getParentDirectory(File dir) {
		return dir == null ? null : dir.getParentFile();
	}

	@Override
	public File getDefaultDirectory() {
		File documents = new File(System.getProperty("user.home"), "Documents"); //$NON-NLS-1$ //$NON-NLS-2$
		return documents.isDirectory() ? documents : getHomeDirectory();
	}

	@Override
	public File getHomeDirectory() {
		return new File(System.getProperty("user.home")); //$NON-NLS-1$
	}

	@Override
	public Boolean isTraversable(File f) {
		return f != null && f.isDirectory();
	}

	@Override
	public boolean isLink(File file) {
		return false;
	}

	@Override
	public File getLinkLocation(File file) {
		return null;
	}

	@Override
	public String getSystemDisplayName(File f) {
		if (f == null) {
			return null;
		}
		// A drive has no name of its own : "C:\"
		return f.getName().isEmpty() ? f.getPath() : f.getName();
	}

	@Override
	public String getSystemTypeDescription(File f) {
		return null;
	}

	@Override
	public Icon getSystemIcon(File f) {
		if (f == null) {
			return null;
		}
		return UIManager.getIcon(f.isDirectory() ? "FileView.directoryIcon" : "FileView.fileIcon"); //$NON-NLS-1$ //$NON-NLS-2$
	}

	@Override
	public File createNewFolder(File containingDir) throws IOException {
		if (containingDir == null) {
			throw new IOException("No folder to create the new folder in"); //$NON-NLS-1$
		}
		String name = UIManager.getString("FileChooser.other.newFolder"); //$NON-NLS-1$
		if (name == null) {
			name = "New Folder"; //$NON-NLS-1$
		}
		File newFolder = new File(containingDir, name);
		for (int i = 2; newFolder.exists(); i++) {
			newFolder = new File(containingDir, name + " (" + i + ")"); //$NON-NLS-1$ //$NON-NLS-2$
		}
		if (!newFolder.mkdir()) {
			throw new IOException("The folder " + newFolder + " could not be created"); //$NON-NLS-1$ //$NON-NLS-2$
		}
		return newFolder;
	}
}
