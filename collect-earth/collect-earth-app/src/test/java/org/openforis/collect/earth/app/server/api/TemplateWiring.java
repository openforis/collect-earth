package org.openforis.collect.earth.app.server.api;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;

import org.springframework.beans.factory.xml.XmlBeanDefinitionReader;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.mock.web.MockServletContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.GenericWebApplicationContext;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/**
 * A MockMvc that handles requests with the Spring MVC beans of the context the server starts with
 * (resources/applicationContext.fmt): its handler mapping, its handler adapter with its converters, and its exception
 * resolvers, which a DispatcherServlet finds by type as the server's does. MockMvc's standaloneSetup would bring
 * converters and resolvers of its own, and so test something other than what the server runs. The rest of the template
 * (data sources, Collect's beans) is left out: only these beans are copied from it, as they are.
 */
public class TemplateWiring {

	private static final List<String> MVC_BEANS = Arrays.asList(
			"org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping",
			"org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerAdapter",
			"org.springframework.web.servlet.mvc.method.annotation.ExceptionHandlerExceptionResolver",
			"org.springframework.web.servlet.mvc.annotation.ResponseStatusExceptionResolver",
			"org.springframework.web.servlet.mvc.support.DefaultHandlerExceptionResolver");

	private TemplateWiring() {
	}

	/** The beans given (controllers, the advice) are added to the template's MVC beans. */
	public static MockMvc mockMvc(Object... beans) throws Exception {
		GenericWebApplicationContext context = new GenericWebApplicationContext(new MockServletContext());
		XmlBeanDefinitionReader reader = new XmlBeanDefinitionReader(context);
		reader.setValidationMode(XmlBeanDefinitionReader.VALIDATION_NONE);
		reader.loadBeanDefinitions(new ByteArrayResource(mvcBeansOfTheTemplate()));
		for (Object bean : beans) {
			registerBean(context, bean);
		}
		context.refresh();
		return MockMvcBuilders.webAppContextSetup(context).build();
	}

	@SuppressWarnings("unchecked")
	private static <T> void registerBean(GenericWebApplicationContext context, T bean) {
		context.registerBean((Class<T>) bean.getClass(), () -> bean);
	}

	// Surefire runs the tests in the module folder, which the template's path is relative to
	private static byte[] mvcBeansOfTheTemplate() throws Exception {
		return mvcBeansOf(new File("resources/applicationContext.fmt"));
	}

	/**
	 * The template is read as XML, as it is: this works while it stays well-formed XML outside its ${...}
	 * placeholders, which sit in attribute values. If Freemarker directives (&lt;#if&gt;, &lt;#list&gt;...) are ever
	 * added to it, it has to be rendered with Freemarker first, as ServerController does.
	 */
	static byte[] mvcBeansOf(File templateFile) throws Exception {
		DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
		factory.setNamespaceAware(true);
		Document template = factory.newDocumentBuilder().parse(templateFile);
		Element root = template.getDocumentElement();
		NodeList children = root.getChildNodes();
		Set<String> missing = new LinkedHashSet<>(MVC_BEANS);
		for (int i = children.getLength() - 1; i >= 0; i--) {
			Node child = children.item(i);
			boolean mvcBean = child instanceof Element && "bean".equals(child.getLocalName())
					&& MVC_BEANS.contains(((Element) child).getAttribute("class"));
			if (mvcBean) {
				missing.remove(((Element) child).getAttribute("class"));
			} else {
				root.removeChild(child);
			}
		}
		// Without one of them the DispatcherServlet's default would stand in for it, silently, and the tests would no
		// longer run what the server runs
		if (!missing.isEmpty()) {
			throw new IllegalStateException(templateFile + " no longer declares " + missing
					+ ": TemplateWiring has to follow how the template wires Spring MVC now");
		}
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		TransformerFactory.newInstance().newTransformer().transform(new DOMSource(template), new StreamResult(out));
		return out.toByteArray();
	}
}
