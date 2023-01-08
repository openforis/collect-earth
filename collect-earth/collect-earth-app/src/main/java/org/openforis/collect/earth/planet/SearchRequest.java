package org.openforis.collect.earth.planet;

public class SearchRequest{

	String[] item_types;
	Filter<?> filter;
	String[] ids;

	public SearchRequest(String[] ids) {
		super();
		this.ids = ids;
	}

	public SearchRequest(String[] itemTypes, Filter<?> filter) {
		super();
		this.item_types = itemTypes;
		this.filter = filter;
	}

	public String[] getItemTypes() {
		return item_types;
	}

	public void setItemTypes(String[] itemTypes) {
		this.item_types = itemTypes;
	}

	public Filter<?> getFilter() {
		return filter;
	}

	public void setFilter(Filter<?> filter) {
		this.filter = filter;
	}

}
