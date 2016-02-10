package org.openforis.collect.earth.app.desktop;

import java.io.File;
import java.io.IOException;
import java.lang.reflect.Method;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Use reflection to be able to add the code specific to Mac OS X without generating compilation errors
 * This class generates a Proxy so that an Interface method can be invoked. Sort of implementing an Interface using reflection
 * @see <a href="https://blogs.oracle.com/poonam/entry/how_to_implement_an_interface">How to implement an interface using Reflection</a>
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
public class MacOpenFilesInvocationHandler implements java.lang.reflect.InvocationHandler {

	private final Logger logger = LoggerFactory.getLogger(MacOpenFilesInvocationHandler.class);
	
    public MacOpenFilesInvocationHandler() {         
    	super();
    }    

    public Object invoke(Object proxy, Method m, Object[] args) throws Throwable

    {

        Object result = null;

        try {

            // Prints the method being invoked
        	String message = "";
        	message = "begin method "+ m.getName() + "(";
            
            for(int i=0; i<args.length; i++){
                if(i>0) 
                	message +=",";

                message += " " +  args[i].toString();
            
            }

            message += " )";

         logger.error( message + m.getName() );
         // if the method name equals some method's name then call your method

         if (m.getName().equals("openFiles")) {
        	 
        	 openFilesImplmentation(args[0]);

         }

      } catch (Exception e) {
    	  logger.error(" Error while interpreting invocation " , e );
           throw new RuntimeException("unexpected invocation exception: " + e.getMessage());
     } finally {
             System.out.println("end method " + m.getName());
    }

   return result;

  }

  private void openFilesImplmentation(Object openFilesEventObject) throws Exception {
	  Class openFilesEventClass = Class.forName("com.apple.eawt.AppEvent.OpenFilesEvent");
	  Method getFilesMethod = openFilesEventClass.getMethod("getFiles");
	  
	  List<File> files = (List<File>) getFilesMethod.invoke( openFilesEventObject );
	  
	  
	  for (File file : files ){
      	try {
				EarthApp.openProjectFileInRunningCollectEarth(file.getAbsolutePath());
			} catch (IOException e1) {
				logger.error("Error opening CEP file " + e1);
			}
      }

  }
  }

