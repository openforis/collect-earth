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

		plot.setGridFlags(getGridFlags(row, column));

		session.save(plot);

		// Flush when the row changes : the test was inverted, so row 0 flushed after every plot and no later row ever did,
		// which kept every plot of the run in memory
		if(!lastRow.equals( row) ) {
			lastRow = row;
			session.flush();
	        session.clear();
		}

	}

	@Override
	public void closeStore() {
		// Guarded and in a finally : the store is closed from a finally block, so it is also reached when opening it failed,
		// and a commit that threw used to leave the session factory and its connections open
		try {
			if( session != null && session.getTransaction() != null ) {
				try {
					session.getTransaction().commit();
				} catch (RuntimeException e) {
					session.getTransaction().rollback();
					throw e;
				}
			}
		} finally {
			if( sessionFactory != null ) {
				sessionFactory.close();
			}
			session = null;
			sessionFactory = null;
		}
	}


}
