package org.openforis.collect.earth.ipcc.serialize;

import javax.xml.bind.annotation.XmlAccessType;
import javax.xml.bind.annotation.XmlAccessorType;
import javax.xml.bind.annotation.XmlType;

/**
 * <p>Java class for anonymous complex type.
 * 
 * <p>The following schema fragment specifies the expected content contained within this class.
 * 
 * <pre>
 * &lt;complexType>
 *   &lt;complexContent>
 *     &lt;restriction base="{http://www.w3.org/2001/XMLSchema}anyType">
 *       &lt;choice>
 *         &lt;element name="customRegions" type="{http://ipcc2006.air.sk/IPCC2006Export}CustomRegions"/>
 *         &lt;element name="landTypes" type="{http://ipcc2006.air.sk/IPCC2006Export}landTypes"/>
 *       &lt;/choice>
 *     &lt;/restriction>
 *   &lt;/complexContent>
 * &lt;/complexType>
 * </pre>
 * 
 * 
 */
@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(name = "", propOrder = {
    "customRegions",
    "landTypes"
})
public class Record {

    protected CustomRegions customRegions;
    protected LandTypes landTypes;

    /**
     * Gets the value of the customRegions property.
     * 
     * @return
     *     possible object is
     *     {@link CustomRegions }
     *     
     */
    public CustomRegions getCustomRegions() {
        return customRegions;
    }

    /**
     * Sets the value of the customRegions property.
     * 
     * @param value
     *     allowed object is
     *     {@link CustomRegions }
     *     
     */
    public void setCustomRegions(CustomRegions value) {
        this.customRegions = value;
    }

    /**
     * Gets the value of the landTypes property.
     * 
     * @return
     *     possible object is
     *     {@link LandTypes }
     *     
     */
    public LandTypes getLandTypes() {
        return landTypes;
    }

    /**
     * Sets the value of the landTypes property.
     * 
     * @param value
     *     allowed object is
     *     {@link LandTypes }
     *     
     */
    public void setLandTypes(LandTypes value) {
        this.landTypes = value;
    }

}