package org.openforis.collect.earth.app.springversion;

import java.io.File;
import java.io.IOException;
import java.net.MalformedURLException;
import java.net.URISyntaxException;

import javax.servlet.ServletContext;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import org.apache.commons.io.FileUtils;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

@Controller
public class TestGeServlet extends DataAccessingServlet {

	private static final String KMZ_FILE = "/gePlugin.kmz";

	private byte[] fileBytes;

	@RequestMapping("/getKmzFile")
	public void getKmzFile(HttpServletResponse response, HttpServletRequest request) throws IOException, URISyntaxException {

		if (fileBytes == null) {
			fileBytes = readFile(KMZ_FILE, request.getSession().getServletContext());
		}

		returnKmz(response, fileBytes, KMZ_FILE);
	}

	private byte[] readFile(String filePath, ServletContext servletContext) throws MalformedURLException, URISyntaxException {

		File imageFile = new File(servletContext.getResource(filePath).toURI());
		byte fileContent[] = new byte[0];
		try {
			fileContent = FileUtils.readFileToByteArray(imageFile);
		} catch (IOException e) {
			getLogger().error("Problems while reading the file " + filePath + " was not found.", e);
		}
		return fileContent;
	}

	private void returnKmz(HttpServletResponse response, byte[] fileBytes, String imageName) throws IOException {
		response.setHeader("Content-Type", "application/vnd.google-earth.kmz");
		response.setHeader("Content-Disposition", "inline; filename=\"" + imageName + "\"");
		response.setHeader("Cache-Control", "max-age=30");

		response.setHeader("Content-Length", fileBytes.length + "");
		writeToResponse(response, fileBytes);
	}

	private void writeToResponse(HttpServletResponse response, byte[] fileContents) throws IOException {
		response.getOutputStream().write(fileContents);
		response.getOutputStream().close();
	}
}
