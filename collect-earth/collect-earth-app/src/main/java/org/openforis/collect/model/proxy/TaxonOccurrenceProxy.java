/**
 * 
 */
package org.openforis.collect.model.proxy;

import java.util.ArrayList;
import java.util.List;

import org.openforis.collect.Proxy;
import org.openforis.idm.model.TaxonOccurrence;

/**
 * @author S. Ricci
 *
 */
public class TaxonOccurrenceProxy implements Proxy {

	private TaxonOccurrence occurrence;

	public TaxonOccurrenceProxy(TaxonOccurrence occurence) {
		super();
		this.occurrence = occurence;
	}
	
	public static List<TaxonOccurrenceProxy> fromList(List<TaxonOccurrence> list) {
		List<TaxonOccurrenceProxy> proxies = new ArrayList<>();
		if (list != null) {
			for (TaxonOccurrence item : list) {
				proxies.add(new TaxonOccurrenceProxy(item));
			}
		}
		return proxies;
	}

	public String getCode() {
		return occurrence.getCode();
	}

	public String getScientificName() {
		return occurrence.getScientificName();
	}

	public String getVernacularName() {
		return occurrence.getVernacularName();
	}

	public String getLanguageCode() {
		return occurrence.getLanguageCode();
	}

	public String getLanguageVariety() {
		return occurrence.getLanguageVariety();
	}
	
}
