package org.openforis.collect.earth.app.service.tools;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.openforis.collect.earth.app.service.EarthSurveyService;
import org.openforis.collect.earth.app.service.ExportType;
import org.openforis.collect.earth.app.service.IPCCGeneratorService;
import org.openforis.collect.earth.app.service.jobs.RecordingContext;
import org.openforis.collect.earth.app.service.tools.IpccAnswers.Subdivision;
import org.openforis.collect.earth.app.service.tools.ToolsService.InvalidToolRequestException;
import org.openforis.collect.earth.ipcc.model.AbstractLandUseSubdivision;
import org.openforis.collect.earth.ipcc.model.CountryCode;
import org.openforis.collect.earth.ipcc.model.CroplandSubdivision;
import org.openforis.collect.earth.ipcc.model.CroplandTypeEnum;
import org.openforis.collect.earth.ipcc.model.ForestSubdivision;
import org.openforis.collect.earth.ipcc.model.ForestTypeEnum;
import org.openforis.collect.earth.ipcc.model.ManagementTypeEnum;
import org.openforis.collect.earth.ipcc.model.PerennialCropTypesEnum;
import org.openforis.collect.earth.ipcc.model.WetlandSubdivision;
import org.openforis.collect.model.CollectSurvey;
import org.openforis.idm.metamodel.EntityDefinition;
import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.Schema;

/** The LULUCF package as jobs, over stood-in services. */
public class AnalysisServiceTest {

	@TempDir
	File folder;

	private final IPCCGeneratorService ipcc = mock(IPCCGeneratorService.class);
	private final EarthSurveyService surveys = mock(EarthSurveyService.class);
	private final CountryCode[] countries = { new CountryCode("ES", "Spain"), new CountryCode("KE", "Kenya") };
	private final AnalysisService service = new AnalysisService(ipcc, surveys, () -> countries);
	private final ForestSubdivision forest = new ForestSubdivision("F1", "Dense forest", null, 1, null);
	private final CroplandSubdivision cropland = new CroplandSubdivision("C1", "Maize", null, 2);
	private final WetlandSubdivision wetland = new WetlandSubdivision("W1", "Marsh", ManagementTypeEnum.MANAGED, 3);

	@BeforeEach
	public void aSurveyWithThreeSubdivisions() {
		CollectSurvey survey = mock(CollectSurvey.class);
		when(surveys.getCollectSurvey()).thenReturn(survey);
		Schema schema = mock(Schema.class);
		when(survey.getSchema()).thenReturn(schema);
		EntityDefinition root = mock(EntityDefinition.class);
		when(schema.getFirstRootEntityDefinition()).thenReturn(root);
		List<NodeDefinition> children = new ArrayList<>();
		for (String name : new String[] { "id", "province", "land_use" }) {
			NodeDefinition child = mock(NodeDefinition.class);
			when(child.getName()).thenReturn(name);
			children.add(child);
		}
		when(root.getChildDefinitions()).thenReturn(children);
		List<AbstractLandUseSubdivision> subdivisions = Arrays.asList(forest, cropland, wetland);
		when(ipcc.getLandUseSubdivisions()).thenReturn(subdivisions);
	}

	@Test
	public void whatTheDialogAsksFirst() {
		when(ipcc.isRdbAlreadyGenerated(ExportType.IPCC)).thenReturn(false);
		Map<String, Object> analysis = service.analysis();
		assertEquals(false, analysis.get("ipccGenerated"));
		assertEquals(true, analysis.get("survey"));
	}

	@Test
	public void withoutASurveyNothingStarts() {
		when(surveys.getCollectSurvey()).thenReturn(null);
		assertEquals("tools.noSurvey", assertThrows(InvalidToolRequestException.class, () -> service.ipccPrepare(false)).getCode());
	}

	@Test
	@SuppressWarnings("unchecked")
	public void theIpccPreparationAnswersTheForm() throws Exception {
		Map<String, Object> form = (Map<String, Object>) service.ipccPrepare(true).run(new RecordingContext());
		verify(ipcc).setRefreshDatabase(true);
		verify(ipcc).prepareDatabase(any());
		List<Map<String, String>> countryList = (List<Map<String, String>>) form.get("countries");
		assertEquals("ES", countryList.get(0).get("code"));
		assertEquals(Arrays.asList("id", "province", "land_use"), form.get("attributes"));
		assertEquals("province", form.get("defaultAttribute"));
		List<Map<String, Object>> categories = (List<Map<String, Object>>) form.get("categories");
		assertEquals(6, categories.size());
		Map<String, Object> forests = categories.get(0);
		assertEquals("F", forests.get("code"));
		List<Map<String, String>> managementTypes = (List<Map<String, String>>) forests.get("managementTypes");
		assertEquals("MANAGED", managementTypes.get(0).get("value"));
		assertEquals("Managed", managementTypes.get(0).get("label"));
		Map<String, Object> extra = (Map<String, Object>) forests.get("extra");
		assertEquals("forestType", extra.get("name"));
		assertEquals(ForestTypeEnum.values().length, ((List<?>) extra.get("options")).size());
		List<Map<String, Object>> rows = (List<Map<String, Object>>) forests.get("subdivisions");
		assertEquals(1, rows.size());
		assertEquals("F1", rows.get(0).get("code"));
		assertEquals(forest.getGuid(), rows.get(0).get("guid"));
		assertNull(rows.get(0).get("managementType"));
		Map<String, Object> croplands = categories.get(1);
		assertEquals("ANNUAL", ((List<Map<String, String>>) croplands.get("managementTypes")).get(0).get("value"));
		assertEquals("perennialCropType", ((Map<String, Object>) croplands.get("extra")).get("name"));
		Map<String, Object> wetlands = categories.get(3);
		assertNull(wetlands.get("extra"));
		assertEquals("MANAGED", ((List<Map<String, Object>>) wetlands.get("subdivisions")).get(0).get("managementType"));
		assertEquals(0, ((List<?>) categories.get(5).get("subdivisions")).size());
	}

	private IpccAnswers answers(String country, String region, String path) {
		IpccAnswers answers = new IpccAnswers();
		answers.country = country;
		answers.regionAttribute = region;
		answers.path = path;
		answers.subdivisions = new ArrayList<>();
		answers.subdivisions.add(answer(forest.getGuid(), "MANAGED", "PINUS"));
		answers.subdivisions.add(answer(cropland.getGuid(), "PERENNIAL", "OIL_PALM"));
		answers.subdivisions.add(answer(wetland.getGuid(), "UNMANAGED", null));
		return answers;
	}

	private static Subdivision answer(String guid, String management, String type) {
		Subdivision answer = new Subdivision();
		answer.guid = guid;
		answer.managementType = management;
		answer.type = type;
		return answer;
	}

	@Test
	public void theAnswersGoOnTheSubdivisionsAndTheOutputsAreProduced() throws Exception {
		File zip = new File(folder, "LandUseForGHGi.zip");
		Map<?, ?> result = (Map<?, ?>) service.ipccOutputs(answers("KE", "province", zip.getPath())).run(new RecordingContext());
		assertEquals(zip.getAbsolutePath(), result.get("path"));
		assertEquals(ManagementTypeEnum.MANAGED, forest.getManagementType());
		assertEquals(ForestTypeEnum.PINUS, forest.getForestType());
		assertEquals(CroplandTypeEnum.PERENNIAL, cropland.getManagementType());
		assertEquals(PerennialCropTypesEnum.OIL_PALM, cropland.getPerennialCropType());
		assertEquals(ManagementTypeEnum.UNMANAGED, wetland.getManagementType());
		verify(ipcc).produceOutputs(eq("KE"), eq("province"), eq(zip), any());
	}

	@Test
	public void theAnswersAreCheckedBeforeTheJob() throws Exception {
		assertEquals("ipcc.country", assertThrows(InvalidToolRequestException.class, () -> service.ipccOutputs(answers("XX", "province", "x.zip"))).getCode());
		assertEquals("ipcc.region", assertThrows(InvalidToolRequestException.class, () -> service.ipccOutputs(answers("ES", "region", "x.zip"))).getCode());
		assertEquals("export.path", assertThrows(InvalidToolRequestException.class, () -> service.ipccOutputs(answers("ES", "province", ""))).getCode());
		IpccAnswers missing = answers("ES", "province", "x.zip");
		missing.subdivisions.remove(0);
		assertEquals("ipcc.subdivision", assertThrows(InvalidToolRequestException.class, () -> service.ipccOutputs(missing)).getCode());
		IpccAnswers wrongType = answers("ES", "province", "x.zip");
		wrongType.subdivisions.get(2).managementType = "PERENNIAL";
		assertEquals("ipcc.subdivision", assertThrows(InvalidToolRequestException.class, () -> service.ipccOutputs(wrongType)).getCode());
		verify(ipcc, never()).produceOutputs(any(), any(), any(), any());
		// A cropland without a perennial type takes all of them, as the wizard's combo started on ALL
		IpccAnswers noCropType = answers("ES", "province", "x.zip");
		noCropType.subdivisions.get(1).type = null;
		service.ipccOutputs(noCropType);
		assertEquals(PerennialCropTypesEnum.ALL, cropland.getPerennialCropType());
		// Without province, country or district, the first attribute
		assertEquals("id", IpccForm.defaultAttribute(Arrays.asList("id", "land_use")));
		assertNull(IpccForm.defaultAttribute(Collections.emptyList()));
	}
}
