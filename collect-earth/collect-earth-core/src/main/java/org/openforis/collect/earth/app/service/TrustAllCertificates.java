package org.openforis.collect.earth.app.service;

import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;

import javax.net.ssl.X509TrustManager;

public class TrustAllCertificates  implements X509TrustManager {
	@Override
	public void checkClientTrusted(X509Certificate[] cert, String s) throws CertificateException {
		// TRUST EVERYTHING!
	}

	@Override
	public void checkServerTrusted(X509Certificate[] cert, String s) throws CertificateException {
		// DOES NOT CHECK A THING
	}

	@Override
	public X509Certificate[] getAcceptedIssuers() {
		return new X509Certificate[0];
	}

}