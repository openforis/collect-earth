package org.openforis.collect.earth.sampler.utils;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Repairs the way an older project template draws the reference areas around a plot.
 *
 * <p>
 * The KML template of a project generated between 2019 and September 2026 writes the reference areas
 * (<code>placemark.buffers</code>, the <code>distance_to_buffers</code> property) into the plot's own
 * <code>&lt;outerBoundaryIs&gt;</code>, and then adds one more <code>&lt;outerBoundaryIs&gt;</code> per reference area.
 * A KML <code>Polygon</code> has exactly one outer boundary, so Google Earth keeps one of them: the plot frame is not
 * drawn at all and a reference area takes its place. It went unnoticed while <code>distance_to_buffers</code> was
 * something only a hand-edited earth.properties held; the plot options panel is the first thing that lets an
 * interpreter set it.
 * </p>
 *
 * <p>
 * This class rewrites only those loops, in the copy of the template that is processed. The file in the project folder
 * is never modified, so a template that the project customised keeps every other change its author made, and a project
 * that is exported again from the survey designer simply stops needing the repair.
 * </p>
 *
 * @author Alfonso Sanchez-Paus Diaz
 */
public final class KmlTemplateUpgrader {

	private static final Logger logger = LoggerFactory.getLogger(KmlTemplateUpgrader.class);

	/** A template that guards the reference areas with this already draws them in a geometry of their own. */
	private static final String CORRECT_REFERENCE_AREA_BLOCK = "placemark.buffers?has_content";

	/** The opening of a loop over the reference areas, whatever the loop variable is called. */
	private static final Pattern REFERENCE_AREA_LOOP = Pattern.compile("<#list\\s+placemark\\.buffers\\s+as\\s+\\w+\\s*>");

	/** The plot's own placemark, the anchor the repaired block is written in front of. */
	private static final Pattern PLOT_PLACEMARK = Pattern.compile("<Placemark\\s+id=\"\\$\\{placemark\\.placemarkId\\}\"");

	private static final String LIST_OPEN = "<#list";
	private static final String LIST_CLOSE = "</#list>";

	/**
	 * The reference areas, each in its own polygon of a placemark of its own, so that they cannot interfere with the plot
	 * boundary. The style is written inline because an older template has no style defined for them.
	 */
	private static final String REFERENCE_AREA_BLOCK =
			"<#-- The reference areas, repaired by Collect Earth : the template of this project drew them inside the\n" +
			"     plot's own boundary, which left Google Earth showing a reference area in place of the plot frame -->\n" +
			"<#if placemark.buffers?has_content >\n" +
			"<Placemark>\n" +
			"	<Style>\n" +
			"		<BalloonStyle><displayMode>hide</displayMode></BalloonStyle>\n" +
			"		<PolyStyle><fill>0</fill></PolyStyle>\n" +
			"		<LineStyle><color>8800FFFF</color><colorMode>normal</colorMode><width>1</width></LineStyle>\n" +
			"	</Style>\n" +
			"	<MultiGeometry>\n" +
			"	<#list placemark.buffers as referenceArea>\n" +
			"		<Polygon id=\"poly_${placemark.placemarkId}_reference_area_${referenceArea_index}\">\n" +
			"			<outerBoundaryIs>\n" +
			"				<LinearRing>\n" +
			"					<extrude>0</extrude>\n" +
			"					<coordinates>\n" +
			"					<#list referenceArea.shape as coord>\n" +
			"						${coord.longitude},${coord.latitude},0\n" +
			"					</#list>\n" +
			"					</coordinates>\n" +
			"				</LinearRing>\n" +
			"			</outerBoundaryIs>\n" +
			"		</Polygon>\n" +
			"	</#list>\n" +
			"	</MultiGeometry>\n" +
			"</Placemark>\n" +
			"</#if>\n";

	private KmlTemplateUpgrader() {}

	/**
	 * @param templateSource the text of the project's KML template
	 * @param templateName the name of the template file, for the log
	 * @return the same text when the template already draws the reference areas correctly, or when it cannot be
	 *         repaired; otherwise the text with the reference areas moved out of the plot boundary
	 */
	public static String repairReferenceAreas(String templateSource, String templateName) {
		if (templateSource.contains(CORRECT_REFERENCE_AREA_BLOCK)) {
			return templateSource;
		}

		final String withoutBrokenLoops = removeReferenceAreaLoops(templateSource);
		final Matcher plotPlacemark = PLOT_PLACEMARK.matcher(withoutBrokenLoops);
		if (!plotPlacemark.find()) {
			// Without the anchor there is nowhere to put the block. A template that never mentioned the reference areas
			// keeps working as it did; one that drew them wrongly is left alone rather than half repaired
			logger.warn(
					"The template {} does not draw the reference areas around the plot. Export the project again from the survey designer to have them drawn",
					templateName);
			return templateSource;
		}

		final String repaired = new StringBuilder(withoutBrokenLoops)
				.insert(plotPlacemark.start(), REFERENCE_AREA_BLOCK)
				.toString();
		logger.info("The reference areas of the template {} are drawn in a placemark of their own. The file itself is not modified",
				templateName);
		return repaired;
	}

	/**
	 * Removes every loop over the reference areas, with whatever it holds. In an older template there are two of them,
	 * one inside the coordinates of the plot boundary and one adding an outer boundary per reference area.
	 */
	private static String removeReferenceAreaLoops(String templateSource) {
		String source = templateSource;
		Matcher loop = REFERENCE_AREA_LOOP.matcher(source);
		while (loop.find()) {
			final int end = endOfList(source, loop.end());
			if (end < 0) {
				// The template does not close the loop; Freemarker would refuse it anyway, so leave it as the author wrote it
				logger.warn("A loop over the reference areas of the template is not closed; it is left as it is");
				return templateSource;
			}
			source = source.substring(0, loop.start()) + source.substring(end);
			loop = REFERENCE_AREA_LOOP.matcher(source);
		}
		return source;
	}

	/**
	 * @param from the index just after the opening tag of a list
	 * @return the index just after the {@code </#list>} that closes it, counting the lists nested in it, or -1
	 */
	private static int endOfList(String source, int from) {
		int depth = 1;
		int i = from;
		while (i < source.length()) {
			if (source.startsWith(LIST_CLOSE, i)) {
				depth--;
				i += LIST_CLOSE.length();
				if (depth == 0) {
					return i;
				}
			} else if (source.startsWith(LIST_OPEN, i)) {
				depth++;
				i += LIST_OPEN.length();
			} else {
				i++;
			}
		}
		return -1;
	}
}
