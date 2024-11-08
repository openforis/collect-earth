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
import javax.xml.bind.annotation.XmlType;


/**
 * <p>Java class for lrtLandUnit complex type.
 * 
 * <p>The following schema fragment specifies the expected content contained within this class.
 * 
 * <pre>
 * &lt;complexType name="lrtLandUnit">
 *   &lt;complexContent>
 *     &lt;restriction base="{http://www.w3.org/2001/XMLSchema}anyType">
 *       &lt;sequence>
 *         &lt;element name="guid" type="{http://ipcc2006.air.sk/IPCC2006Export}guid"/>
 *         &lt;element name="unitCode" type="{http://www.w3.org/2001/XMLSchema}string"/>
 *         &lt;element name="ltIdPrev" type="{http://www.w3.org/2001/XMLSchema}integer"/>
 *         &lt;element name="cltIdPrev" type="{http://www.w3.org/2001/XMLSchema}integer"/>
 *         &lt;element name="transPeriod" type="{http://www.w3.org/2001/XMLSchema}integer"/>
 *         &lt;element name="convYear" type="{http://www.w3.org/2001/XMLSchema}integer"/>
 *         &lt;element name="areas">
 *           &lt;complexType>
 *             &lt;complexContent>
 *               &lt;restriction base="{http://www.w3.org/2001/XMLSchema}anyType">
 *                 &lt;sequence>
 *                   &lt;element name="area" type="{http://ipcc2006.air.sk/IPCC2006Export}lrtLandUnitArea" maxOccurs="unbounded" minOccurs="0"/>
 *                 &lt;/sequence>
 *               &lt;/restriction>
 *             &lt;/complexContent>
 *           &lt;/complexType>
 *         &lt;/element>
 *         &lt;element name="areasA1D">
 *           &lt;complexType>
 *             &lt;complexContent>
 *               &lt;restriction base="{http://www.w3.org/2001/XMLSchema}anyType">
 *                 &lt;sequence>
 *                   &lt;element name="areaA1D" type="{http://ipcc2006.air.sk/IPCC2006Export}lrtLandUnitArea" maxOccurs="unbounded" minOccurs="0"/>
 *                 &lt;/sequence>
 *               &lt;/restriction>
 *             &lt;/complexContent>
 *           &lt;/complexType>
 *         &lt;/element>
 *         &lt;element name="isMerged" type="{http://www.w3.org/2001/XMLSchema}boolean"/>
 *         &lt;element name="pmBiomass" type="{http://www.w3.org/2001/XMLSchema}integer"/>
 *         &lt;element name="pmDomDeadwood" type="{http://www.w3.org/2001/XMLSchema}integer"/>
 *         &lt;element name="pmDomLitter" type="{http://www.w3.org/2001/XMLSchema}integer"/>
 *         &lt;element name="pmSomMineral" type="{http://www.w3.org/2001/XMLSchema}integer"/>
 *         &lt;element name="remark" type="{http://www.w3.org/2001/XMLSchema}string"/>
 *         &lt;element name="history" type="{http://ipcc2006.air.sk/IPCC2006Export}lrtLandUnitHistory"/>
 *       &lt;/sequence>
 *     &lt;/restriction>
 *   &lt;/complexContent>
 * &lt;/complexType>
 * </pre>
 * 
 * 
 */
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(name = "lrtLandUnit", propOrder = {
    "guid",
    "unitCode",
    "ltIdPrev",
    "cltIdPrev",
    "transPeriod",
    "convYear",
    "areas",
    "areasA1D",
    "isMerged",
    "pmBiomass",
    "pmDomDeadwood",
    "pmDomLitter",
    "pmSomMineral",
    "remark",
    "history"
})
public class LrtLandUnit {

    @XmlElement(required = true)
    protected String guid;
    @XmlElement(required = true, nillable = true)
    protected String unitCode;
    @XmlElement(required = true)
    protected Integer ltIdPrev;
    @XmlElement(required = true)
    protected Integer cltIdPrev;
    @XmlElement(required = true)
    protected Integer transPeriod;
    @XmlElement(required = true)
    protected Integer convYear;
    @XmlElement(required = true)
    protected LrtLandUnit.Areas areas;
    @XmlElement(required = true)
    protected LrtLandUnit.AreasA1D areasA1D;
    protected boolean isMerged;
    @XmlElement(required = true)
    protected Integer pmBiomass;
    @XmlElement(required = true)
    protected Integer pmDomDeadwood;
    @XmlElement(required = true)
    protected Integer pmDomLitter;
    @XmlElement(required = true)
    protected Integer pmSomMineral;
    @XmlElement(required = true, nillable = true)
    protected String remark;
    @XmlElement(required = true)
    protected LrtLandUnitHistory history;

    /**
     * Gets the value of the guid property.
     * 
     * @return
     *     possible object is
     *     {@link String }
     *     
     */
    public String getGuid() {
        return guid;
    }

    /**
     * Sets the value of the guid property.
     * 
     * @param value
     *     allowed object is
     *     {@link String }
     *     
     */
    public void setGuid(String value) {
        this.guid = value;
    }

    /**
     * Gets the value of the unitCode property.
     * 
     * @return
     *     possible object is
     *     {@link String }
     *     
     */
    public String getUnitCode() {
        return unitCode;
    }

    /**
     * Sets the value of the unitCode property.
     * 
     * @param value
     *     allowed object is
     *     {@link String }
     *     
     */
    public void setUnitCode(String value) {
        this.unitCode = value;
    }

    /**
     * Gets the value of the ltIdPrev property.
     * 
     * @return
     *     possible object is
     *     {@link Integer }
     *     
     */
    public Integer getLtIdPrev() {
        return ltIdPrev;
    }

    /**
     * Sets the value of the ltIdPrev property.
     * 
     * @param value
     *     allowed object is
     *     {@link Integer }
     *     
     */
    public void setLtIdPrev(Integer value) {
        this.ltIdPrev = value;
    }

    /**
     * Gets the value of the cltIdPrev property.
     * 
     * @return
     *     possible object is
     *     {@link Integer }
     *     
     */
    public Integer getCltIdPrev() {
        return cltIdPrev;
    }

    /**
     * Sets the value of the cltIdPrev property.
     * 
     * @param value
     *     allowed object is
     *     {@link Integer }
     *     
     */
    public void setCltIdPrev(Integer value) {
        this.cltIdPrev = value;
    }

    /**
     * Gets the value of the transPeriod property.
     * 
     * @return
     *     possible object is
     *     {@link Integer }
     *     
     */
    public Integer getTransPeriod() {
        return transPeriod;
    }

    /**
     * Sets the value of the transPeriod property.
     * 
     * @param value
     *     allowed object is
     *     {@link Integer }
     *     
     */
    public void setTransPeriod(Integer value) {
        this.transPeriod = value;
    }

    /**
     * Gets the value of the convYear property.
     * 
     * @return
     *     possible object is
     *     {@link Integer }
     *     
     */
    public Integer getConvYear() {
        return convYear;
    }

    /**
     * Sets the value of the convYear property.
     * 
     * @param value
     *     allowed object is
     *     {@link Integer }
     *     
     */
    public void setConvYear(Integer value) {
        this.convYear = value;
    }

    /**
     * Gets the value of the areas property.
     * 
     * @return
     *     possible object is
     *     {@link LrtLandUnit.Areas }
     *     
     */
    public LrtLandUnit.Areas getAreas() {
        return areas;
    }

    /**
     * Sets the value of the areas property.
     * 
     * @param value
     *     allowed object is
     *     {@link LrtLandUnit.Areas }
     *     
     */
    public void setAreas(LrtLandUnit.Areas value) {
        this.areas = value;
    }

    /**
     * Gets the value of the areasA1D property.
     * 
     * @return
     *     possible object is
     *     {@link LrtLandUnit.AreasA1D }
     *     
     */
    public LrtLandUnit.AreasA1D getAreasA1D() {
        return areasA1D;
    }

    /**
     * Sets the value of the areasA1D property.
     * 
     * @param value
     *     allowed object is
     *     {@link LrtLandUnit.AreasA1D }
     *     
     */
    public void setAreasA1D(LrtLandUnit.AreasA1D value) {
        this.areasA1D = value;
    }

    /**
     * Gets the value of the isMerged property.
     * 
     */
    public boolean isIsMerged() {
        return isMerged;
    }

    /**
     * Sets the value of the isMerged property.
     * 
     */
    public void setIsMerged(boolean value) {
        this.isMerged = value;
    }

    /**
     * Gets the value of the pmBiomass property.
     * 
     * @return
     *     possible object is
     *     {@link Integer }
     *     
     */
    public Integer getPmBiomass() {
        return pmBiomass;
    }

    /**
     * Sets the value of the pmBiomass property.
     * 
     * @param value
     *     allowed object is
     *     {@link Integer }
     *     
     */
    public void setPmBiomass(Integer value) {
        this.pmBiomass = value;
    }

    /**
     * Gets the value of the pmDomDeadwood property.
     * 
     * @return
     *     possible object is
     *     {@link Integer }
     *     
     */
    public Integer getPmDomDeadwood() {
        return pmDomDeadwood;
    }

    /**
     * Sets the value of the pmDomDeadwood property.
     * 
     * @param value
     *     allowed object is
     *     {@link Integer }
     *     
     */
    public void setPmDomDeadwood(Integer value) {
        this.pmDomDeadwood = value;
    }

    /**
     * Gets the value of the pmDomLitter property.
     * 
     * @return
     *     possible object is
     *     {@link Integer }
     *     
     */
    public Integer getPmDomLitter() {
        return pmDomLitter;
    }

    /**
     * Sets the value of the pmDomLitter property.
     * 
     * @param value
     *     allowed object is
     *     {@link Integer }
     *     
     */
    public void setPmDomLitter(Integer value) {
        this.pmDomLitter = value;
    }

    /**
     * Gets the value of the pmSomMineral property.
     * 
     * @return
     *     possible object is
     *     {@link Integer }
     *     
     */
    public Integer getPmSomMineral() {
        return pmSomMineral;
    }

    /**
     * Sets the value of the pmSomMineral property.
     * 
     * @param value
     *     allowed object is
     *     {@link Integer }
     *     
     */
    public void setPmSomMineral(Integer value) {
        this.pmSomMineral = value;
    }

    /**
     * Gets the value of the remark property.
     * 
     * @return
     *     possible object is
     *     {@link String }
     *     
     */
    public String getRemark() {
        return remark;
    }

    /**
     * Sets the value of the remark property.
     * 
     * @param value
     *     allowed object is
     *     {@link String }
     *     
     */
    public void setRemark(String value) {
        this.remark = value;
    }

    /**
     * Gets the value of the history property.
     * 
     * @return
     *     possible object is
     *     {@link LrtLandUnitHistory }
     *     
     */
    public LrtLandUnitHistory getHistory() {
        return history;
    }

    /**
     * Sets the value of the history property.
     * 
     * @param value
     *     allowed object is
     *     {@link LrtLandUnitHistory }
     *     
     */
    public void setHistory(LrtLandUnitHistory value) {
        this.history = value;
    }


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
     *         &lt;element name="area" type="{http://ipcc2006.air.sk/IPCC2006Export}lrtLandUnitArea" maxOccurs="unbounded" minOccurs="0"/>
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
        "area"
    })
    public static class Areas {

        protected List<LrtLandUnitArea> area;

        /**
         * Gets the value of the area property.
         * 
         * <p>
         * This accessor method returns a reference to the live list,
         * not a snapshot. Therefore any modification you make to the
         * returned list will be present inside the JAXB object.
         * This is why there is not a <CODE>set</CODE> method for the area property.
         * 
         * <p>
         * For example, to add a new item, do as follows:
         * <pre>
         *    getArea().add(newItem);
         * </pre>
         * 
         * 
         * <p>
         * Objects of the following type(s) are allowed in the list
         * {@link LrtLandUnitArea }
         * 
         * 
         */
        public List<LrtLandUnitArea> getArea() {
            if (area == null) {
                area = new ArrayList<LrtLandUnitArea>();
            }
            return this.area;
        }

    }


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
     *         &lt;element name="areaA1D" type="{http://ipcc2006.air.sk/IPCC2006Export}lrtLandUnitArea" maxOccurs="unbounded" minOccurs="0"/>
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
        "areaA1D"
    })
    public static class AreasA1D {

        protected List<LrtLandUnitArea> areaA1D;

        /**
         * Gets the value of the areaA1D property.
         * 
         * <p>
         * This accessor method returns a reference to the live list,
         * not a snapshot. Therefore any modification you make to the
         * returned list will be present inside the JAXB object.
         * This is why there is not a <CODE>set</CODE> method for the areaA1D property.
         * 
         * <p>
         * For example, to add a new item, do as follows:
         * <pre>
         *    getAreaA1D().add(newItem);
         * </pre>
         * 
         * 
         * <p>
         * Objects of the following type(s) are allowed in the list
         * {@link LrtLandUnitArea }
         * 
         * 
         */
        public List<LrtLandUnitArea> getAreaA1D() {
            if (areaA1D == null) {
                areaA1D = new ArrayList<LrtLandUnitArea>();
            }
            return this.areaA1D;
        }

    }

}
