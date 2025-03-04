//
// This file was generated by the JavaTM Architecture for XML Binding(JAXB) Reference Implementation, v2.2.8-b130911.1802 
// See <a href="http://java.sun.com/xml/jaxb">http://java.sun.com/xml/jaxb</a> 
// Any modifications to this file will be lost upon recompilation of the source schema. 
// Generated on: 2023.03.22 at 11:25:06 AM CET 
//


package org.openforis.collect.earth.ipcc.serialize;


import javax.xml.bind.annotation.XmlAccessType;
import javax.xml.bind.annotation.XmlAccessorType;
import javax.xml.bind.annotation.XmlElement;
import javax.xml.bind.annotation.XmlType;


/**
 * <p>Java class for lrtLandSubdivision complex type.
 * 
 * <p>The following schema fragment specifies the expected content contained within this class.
 * 
 * <pre>
 * &lt;complexType name="lrtLandSubdivision">
 *   &lt;complexContent>
 *     &lt;restriction base="{http://www.w3.org/2001/XMLSchema}anyType">
 *       &lt;sequence>
 *         &lt;element name="cltId" type="{http://www.w3.org/2001/XMLSchema}integer"/>
 *         &lt;element name="remark" type="{http://www.w3.org/2001/XMLSchema}string"/>
 *         &lt;element name="landUnits" type="{http://ipcc2006.air.sk/IPCC2006Export}lrtLandUnits"/>
 *       &lt;/sequence>
 *     &lt;/restriction>
 *   &lt;/complexContent>
 * &lt;/complexType>
 * </pre>
 * 
 * 
 */
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(name = "lrtLandSubdivision", propOrder = {
    "cltId",
    "remark",
    "landUnits"
})
public class LrtLandSubdivision {

    @XmlElement(required = true)
    protected Integer cltId;
    @XmlElement(required = true, nillable = true)
    protected String remark;
    @XmlElement(required = true)
    protected LrtLandUnits landUnits;

    /**
     * Gets the value of the cltId property.
     * 
     * @return
     *     possible object is
     *     {@link Integer }
     *     
     */
    public Integer getCltId() {
        return cltId;
    }

    /**
     * Sets the value of the cltId property.
     * 
     * @param value
     *     allowed object is
     *     {@link Integer }
     *     
     */
    public void setCltId(Integer value) {
        this.cltId = value;
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
     * Gets the value of the landUnits property.
     * 
     * @return
     *     possible object is
     *     {@link LrtLandUnits }
     *     
     */
    public LrtLandUnits getLandUnits() {
        return landUnits;
    }

    /**
     * Sets the value of the landUnits property.
     * 
     * @param value
     *     allowed object is
     *     {@link LrtLandUnits }
     *     
     */
    public void setLandUnits(LrtLandUnits value) {
        this.landUnits = value;
    }

}
