package org.openforis.collect.earth.grid;

import org.hibernate.Session;
import org.hibernate.SessionFactory;

public class HibernateStore extends AbstractStore{


	private int distanceBetweenPlots;
	private SessionFactory sessionFactory;
	private Session session;
	private Integer lastRow =0;
	@Override
	public void initializeStore(int distanceBetweenPlots) throws Exception {
		sessionFactory = HibernateUtil.getSessionFactory();
		session = sessionFactory.getCurrentSession();
		session.beginTransaction();
		this.distanceBetweenPlots = distanceBetweenPlots;
	}

	@Override
	public void savePlot(Double latitude, Double longitude, Integer row,
			Integer column){
		Plot plot = new Plot();
		plot.setColumn( column );
		plot.setGridDistance(distanceBetweenPlots);
		plot.setRow( row);
		plot.setxCoordinate(longitude);
		plot.setyCoordinate(latitude);

		int gridFlags = 0;
		for (Integer d : getDistances()) {
			if (column%d + row%d == 0) {
				gridFlags = gridFlags | (1<<d);
			}
		}
		plot.setGridFlags(gridFlags);

		//Save employee
		session.save(plot);

		if(lastRow.equals( row) ) {
			lastRow = row;
			session.flush();
	        session.clear();
		}

	}

	@Override
	public void closeStore() {
		session.getTransaction().commit();
		sessionFactory.close();
	}


}
