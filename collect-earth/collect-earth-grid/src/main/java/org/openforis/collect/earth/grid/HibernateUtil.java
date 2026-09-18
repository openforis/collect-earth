package org.openforis.collect.earth.grid;

import org.hibernate.SessionFactory;
import org.hibernate.boot.registry.StandardServiceRegistryBuilder;
import org.hibernate.cfg.Configuration;
import org.hibernate.service.ServiceRegistry;

public class HibernateUtil {

	private static final String DB_USER_PROPERTY = "globalgrid.db.user";
	private static final String DB_PASSWORD_PROPERTY = "globalgrid.db.password";

	private static SessionFactory sessionFactory;

	private static String getRequiredProperty(String name) {
		final String value = System.getProperty(name);
		if (value == null) {
			throw new IllegalStateException("Set the database credentials when launching : -D" + DB_USER_PROPERTY + "=... -D" + DB_PASSWORD_PROPERTY + "=...");
		}
		return value;
	}
	
	private static SessionFactory buildSessionFactory() {
        try {
            // Create the SessionFactory from hibernate.cfg.xml
        	Configuration configuration = new Configuration();
        	configuration.configure("hibernate.cfg.xml");
        	System.out.println("Hibernate Configuration loaded");
        	
        	// The credentials are not stored in hibernate.cfg.xml ( it is in a public repository )
        	configuration.setProperty("hibernate.connection.username", getRequiredProperty(DB_USER_PROPERTY));
        	configuration.setProperty("hibernate.connection.password", getRequiredProperty(DB_PASSWORD_PROPERTY));
        	
        	configuration.addAnnotatedClass(Plot.class); 
        	
        	ServiceRegistry serviceRegistry = new StandardServiceRegistryBuilder().applySettings(configuration.getProperties()).build();
        	System.out.println("Hibernate serviceRegistry created");
        	
        	SessionFactory sessionFactory = configuration.buildSessionFactory(serviceRegistry);
 
            return sessionFactory;
        }
        catch (Throwable ex) {
            System.err.println("Initial SessionFactory creation failed." + ex);
            ex.printStackTrace();
            throw new ExceptionInInitializerError(ex);
        }
    }
	
	public static SessionFactory getSessionFactory() {
		if(sessionFactory == null) sessionFactory = buildSessionFactory();
        return sessionFactory;
    }
	
	public static void main(String[] args) {
		System.out.println( getSessionFactory() );
	}
}
