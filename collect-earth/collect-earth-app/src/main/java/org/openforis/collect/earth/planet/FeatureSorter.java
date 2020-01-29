package org.openforis.collect.earth.planet;

import java.util.Comparator;;

public class FeatureSorter implements Comparator<Feature>{

	@Override
	public int compare(Feature o1, Feature o2) {
		if( o1.getProperties().getCloudPercent() !=null && o2.getProperties().getCloudPercent() != null  )
			if( o1.getProperties().getCloudPercent() == o2.getProperties().getCloudPercent()) {
					return o2.getProperties().getVisibleConfidencePercent() - o1.getProperties().getVisibleConfidencePercent();
				}else {
					return o1.getProperties().getCloudPercent() - o2.getProperties().getCloudPercent();
				}
		else if( o1.getProperties().getCloudPercent() != null ) {
			return -1;
		}else if( o2.getProperties().getCloudPercent() != null) {
			return 1;
		}else {
			return (int) ( (o1.getProperties().getCloudCover() - o2.getProperties().getCloudCover() ) * 100 );
		}
	}

}
