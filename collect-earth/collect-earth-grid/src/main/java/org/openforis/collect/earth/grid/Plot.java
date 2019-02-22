package org.openforis.collect.earth.grid;

import java.io.Serializable;

import javax.persistence.Column;
import javax.persistence.Entity;
import javax.persistence.Id;
import javax.persistence.Table;

@Entity
@Table(name = "PLOT")
public class Plot implements Serializable{


	private static final long serialVersionUID = -7410372106566739253L;

	@Id
	@Column
	private int gridDistance;
	
	@Id
	@Column
	private int row;

	@Id
	@Column
	private int col;
	
	@Column	
	private double yCoordinate;
		
	@Column
	private double xCoordinate;
	
	@Column
	private int xOffset;
	
	@Column
	private int yOffset;

	@Column
	private int gridFlags;

	public int getGridDistance() {
		return gridDistance;
	}

	public void setGridDistance(int gridDistance) {
		this.gridDistance = gridDistance;
	}

	public int getRow() {
		return row;
	}

	public void setRow(int row) {
		this.row = row;
	}

	public int getColumn() {
		return col;
	}

	public void setColumn(int column) {
		this.col = column;
	}

	public double getyCoordinate() {
		return yCoordinate;
	}

	public void setyCoordinate(double yCoordinate) {
		this.yCoordinate = yCoordinate;
	}

	public double getxCoordinate() {
		return xCoordinate;
	}

	public void setxCoordinate(double xCoordinate) {
		this.xCoordinate = xCoordinate;
	}

	public int getxOffset() {
		return xOffset;
	}

	public void setxOffset(int xOffset) {
		this.xOffset = xOffset;
	}

	public int getyOffset() {
		return yOffset;
	}

	public void setyOffset(int yOffset) {
		this.yOffset = yOffset;
	}

	public int getGridFlags() {
		return gridFlags;
	}

	public void setGridFlags(int gridFlags) {
		this.gridFlags = gridFlags;
	}

	public static long getSerialversionuid() {
		return serialVersionUID;
	}

	
	@Override
	public int hashCode() {
		final int prime = 31;
		int result = 1;
		result = prime * result + col;
		result = prime * result + gridDistance;
		result = prime * result + gridFlags;
		result = prime * result + row;
		long temp;
		temp = Double.doubleToLongBits(xCoordinate);
		result = prime * result + (int) (temp ^ (temp >>> 32));
		result = prime * result + xOffset;
		temp = Double.doubleToLongBits(yCoordinate);
		result = prime * result + (int) (temp ^ (temp >>> 32));
		result = prime * result + yOffset;
		return result;
	}

	@Override
	public boolean equals(Object obj) {
		if (this == obj)
			return true;
		if (obj == null)
			return false;
		if (getClass() != obj.getClass())
			return false;
		Plot other = (Plot) obj;
		if (col != other.col)
			return false;
		if (gridDistance != other.gridDistance)
			return false;
		if (gridFlags != other.gridFlags)
			return false;
		if (row != other.row)
			return false;
		if (Double.doubleToLongBits(xCoordinate) != Double.doubleToLongBits(other.xCoordinate))
			return false;
		if (xOffset != other.xOffset)
			return false;
		if (Double.doubleToLongBits(yCoordinate) != Double.doubleToLongBits(other.yCoordinate))
			return false;
		if (yOffset != other.yOffset)
			return false;
		return true;
	}

	
}
