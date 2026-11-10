// How the expected summaries here were made, with Collect Earth's own code (test/collectImport.test.ts compares them):
//   javac -cp "<collect-earth-app/target/earth-libs>/*" -sourcepath <collect-earth-core/src/main/java> -d out \
//     SummaryDump.java <collect-earth-core/src/main/java>/org/openforis/collect/earth/core/handlers/*.java
//   java -Dstdout.encoding=UTF-8 -cp "out;<earth-libs>/*" SummaryDump types/idml.xml types/1/1.xml ... > types/summaries.json
// and the same for ../desktop-xml-export.zip unzipped (idml.xml, 1/*.xml). Remove any log line before the first "{".
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.openforis.collect.earth.core.handlers.BalloonInputFieldsUtils;
import org.openforis.collect.model.*;
import org.openforis.collect.model.validation.CollectValidator;
import org.openforis.idm.metamodel.*;
import org.openforis.idm.model.*;
import org.openforis.idm.model.expression.ExpressionFactory;
import org.openforis.collect.persistence.xml.CollectSurveyIdmlBinder;
import org.openforis.collect.persistence.xml.DataUnmarshaller;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

/** args: idml, then record files; prints {file: summary} as Collect Earth's CloudRecordSerializer makes it. */
public class SummaryDump {
  public static void main(String[] args) throws Exception {
    CollectSurvey survey;
    try (InputStream is = new FileInputStream(args[0])) {
      survey = (CollectSurvey) new CollectSurveyIdmlBinder(new CollectSurveyContext(new ExpressionFactory(), new CollectValidator(), new Lists())).unmarshal(is, true);
    }
    Map<String, Object> out = new TreeMap<>();
    for (int i = 1; i < args.length; i++) {
      String name = args[i].replace('\\', '/').replaceAll(".*/([^/]+/[^/]+)$", "$1");
      DataUnmarshaller.ParseRecordResult r;
      try (Reader reader = new InputStreamReader(new FileInputStream(args[i]), StandardCharsets.UTF_8)) { r = new DataUnmarshaller(survey).parse(reader); }
      if (!r.isSuccess()) { out.put(name, "FAILED " + r.getFailures()); continue; }
      CollectRecord record = r.getRecord();
      RecordUpdater updater = new RecordUpdater();
      updater.setValidateAfterUpdate(false);
      updater.initializeRecord(record);
      Map<String, String> made = new TreeMap<>();
      new BalloonInputFieldsUtils().getValuesByHtmlParameters(record.getRootEntity()).forEach((k, v) -> made.put(k, v == null ? "" : v));
      out.put(name, made);
    }
    System.out.println(new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT).writeValueAsString(out));
  }
  static class Lists implements CodeListService {
    @SuppressWarnings("unchecked") public <T extends CodeListItem> T loadItem(CodeAttribute attribute) { Code value = attribute.getValue(); for (CodeListItem item : attribute.getDefinition().getList().getItems()) if (value != null && item.getCode().equals(value.getCode())) return (T) item; return null; }
    public <T extends CodeListItem> List<T> loadRootItems(CodeList codeList) { return codeList.getItems(); }
    public <T extends CodeListItem> T loadRootItem(CodeList list, String code, ModelVersion version) { return null; }
    public <T extends CodeListItem> List<T> loadChildItems(T parentItem) { return parentItem.getChildItems(); }
    public <T extends CodeListItem> List<T> loadItems(CodeList codeList, int level) { return codeList.getItems(); }
    public boolean hasItems(Entity parent, CodeAttributeDefinition def) { return !def.getList().getItems().isEmpty(); }
    public <T extends CodeListItem> List<T> loadValidItems(Entity parent, CodeAttributeDefinition def) { return new ArrayList<>(def.getList().<T>getItems()); }
    public <T extends CodeListItem> T loadParentItem(T item) { return null; }
    public boolean hasQualifiableItems(CodeList codeList) { return codeList.getItems().stream().anyMatch(CodeListItem::isQualifiable); }
    public <T extends CodeListItem> void save(T item) {}
    public <T extends CodeListItem> void save(List<T> items) {}
    public <T extends CodeListItem> void delete(T item) {}
    public void deleteAllItems(CodeList list) {}
  }
}
