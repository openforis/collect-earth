package org.openforis.collect.earth.planet;

public class SearchRequest extends RequestQuery{

	String[] item_types;
	Filter filter;
	String[] ids;

	public SearchRequest(String[] ids) {
		super();
		this.ids = ids;
	}

	public SearchRequest(String[] item_types, Filter filter) {
		super();
		this.item_types = item_types;
		this.filter = filter;
	}

	public String[] getItemTypes() {
		return item_types;
	}

	public void setItemTypes(String[] item_types) {
		this.item_types = item_types;
	}

	public Filter getFilter() {
		return filter;
	}

	public void setFilter(Filter filter) {
		this.filter = filter;
	}

}
