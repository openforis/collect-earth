//
// This file was generated by the JavaTM Architecture for XML Binding(JAXB) Reference Implementation, v2.2.8-b130911.1802 
// See <a href="http://java.sun.com/xml/jaxb">http://java.sun.com/xml/jaxb</a> 
// Any modifications to this file will be lost upon recompilation of the source schema. 
// Generated on: 2023.03.22 at 11:25:06 AM CET 
//


package org.openforis.collect.earth.ipcc.serialize;

import java.util.ArrayList;
import java.util.List;

import javax.xml.bind.annotation.XmlAccessType;
import javax.xml.bind.annotation.XmlAccessorType;
import javax.xml.bind.annotation.XmlElement;
import javax.xml.bind.annotation.XmlRootElement;
import javax.xml.bind.annotation.XmlSchemaType;
import javax.xml.bind.annotation.XmlType;
import javax.xml.datatype.XMLGregorianCalendar;


/**
 * <p>Java class for anonymous complex type.
 * 
 * <p>The following schema fragment specifies the expected content contained within this class.
 * 
 * <pre>
 * &lt;complexType>
 *   &lt;complexContent>
 *     &lt;restriction base="{http://www.w3.org/2001/XMLSchema}anyType">
 *       &lt;sequence>
 *         &lt;element name="Version" type="{http://ipcc2006.air.sk/IPCC2006Export}version"/>
 *         &lt;element name="inventoryYear" type="{http://www.w3.org/2001/XMLSchema}gYear"/>
 *         &lt;element name="countryCode" type="{http://ipcc2006.air.sk/IPCC2006Export}countryCode"/>
 *         &lt;element name="tiers">
 *           &lt;complexType>
 *             &lt;complexContent>
 *               &lt;restriction base="{http://www.w3.org/2001/XMLSchema}anyType">
 *                 &lt;sequence>
 *                   &lt;element name="tier" type="{http://ipcc2006.air.sk/IPCC2006Export}Tier" maxOccurs="unbounded" minOccurs="0"/>
 *                 &lt;/sequence>
 *               &lt;/restriction>
 *             &lt;/complexContent>
 *           &lt;/complexType>
 *         &lt;/element>
 *         &lt;element name="ipccSubdivisions" type="{http://ipcc2006.air.sk/IPCC2006Export}ipccSubdivisions"/>
 *         &lt;element name="record" maxOccurs="unbounded" minOccurs="0">
 *           &lt;complexType>
 *             &lt;complexContent>
 *               &lt;restriction base="{http://www.w3.org/2001/XMLSchema}anyType">
 *                 &lt;choice>
 *                   &lt;element name="customRegions" type="{http://ipcc2006.air.sk/IPCC2006Export}CustomRegions"/>
 *                   &lt;element name="landTypes" type="{http://ipcc2006.air.sk/IPCC2006Export}landTypes"/>
 *                 &lt;/choice>
 *               &lt;/restriction>
 *             &lt;/complexContent>
 *           &lt;/complexType>
 *         &lt;/element>
 *       &lt;/sequence>
 *     &lt;/restriction>
 *   &lt;/complexContent>
 * &lt;/complexType>
 * </pre>
 * 
 * 
 */
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(name = "", propOrder = {
    "version",
    "inventoryYear",
    "countryCode",
    "tiers",
    "ipccSubdivisions",
    "record"
})
@XmlRootElement(name = "IPCC2006Export")
public class IPCC2006Export {

	@XmlElement(name = "Version", required = true)
    protected String version;
    @XmlElement(required = true)
    @XmlSchemaType(name = "gYear")
    protected Integer inventoryYear;
    @XmlElement(required = true)
    protected String countryCode;
    @XmlElement(required = true)
    protected Tiers tiers;
    @XmlElement(required = true)
    protected IpccSubdivisions ipccSubdivisions;
    @XmlElement(required = true)
    protected List<Record> record;

    /**
     * Gets the value of the version property.
     * 
     * @return
     *     possible object is
     *     {@link String }
     *     
     */
    public String getVersion() {
        return version;
    }

    /**
     * Sets the value of the version property.
     * 
     * @param value
     *     allowed object is
     *     {@link String }
     *     
     */
    public void setVersion(String value) {
        this.version = value;
    }

    /**
     * Gets the value of the inventoryYear property.
     * 
     * @return
     *     possible object is
     *     {@link XMLGregorianCalendar }
     *     
     */
    public Integer getInventoryYear() {
        return inventoryYear;
    }

    /**
     * Sets the value of the inventoryYear property.
     * 
     * @param value
     *     allowed object is
     *     {@link XMLGregorianCalendar }
     *     
     */
    public void setInventoryYear(Integer value) {
        this.inventoryYear = value;
    }

    /**
     * Gets the value of the countryCode property.
     * 
     * @return
     *     possible object is
     *     {@link String }
     *     
     */
    public String getCountryCode() {
        return countryCode;
    }

    /**
     * Sets the value of the countryCode property.
     * 
     * @param value
     *     allowed object is
     *     {@link String }
     *     
     */
    public void setCountryCode(String value) {
        this.countryCode = value;
    }

    /**
     * Gets the value of the tiers property.
     * 
     * @return
     *     possible object is
     *     {@link Tiers }
     *     
     */
    public Tiers getTiers() {
        return tiers;
    }

    /**
     * Sets the value of the tiers property.
     * 
     * @param value
     *     allowed object is
     *     {@link Tiers }
     *     
     */
    public void setTiers(Tiers value) {
        this.tiers = value;
    }

    /**
     * Gets the value of the ipccSubdivisions property.
     * 
     * @return
     *     possible object is
     *     {@link IpccSubdivisions }
     *     
     */
    public IpccSubdivisions getIpccSubdivisions() {
        return ipccSubdivisions;
    }

    /**
     * Sets the value of the ipccSubdivisions property.
     * 
     * @param value
     *     allowed object is
     *     {@link IpccSubdivisions }
     *     
     */
    public void setIpccSubdivisions(IpccSubdivisions value) {
        this.ipccSubdivisions = value;
    }

    /**
     * Gets the value of the record property.
     * 
     * <p>
     * This accessor method returns a reference to the live list,
     * not a snapshot. Therefore any modification you make to the
     * returned list will be present inside the JAXB object.
     * This is why there is not a <CODE>set</CODE> method for the record property.
     * 
     * <p>
     * For example, to add a new item, do as follows:
     * <pre>
     *    getRecord().add(newItem);
     * </pre>
     * 
     * 
     * <p>
     * Objects of the following type(s) are allowed in the list
     * {@link Record }
     * 
     * 
     */
    public List<Record> getRecord() {
        if (record == null) {
            record = new ArrayList<Record>();
        }
        return this.record;
    }

}