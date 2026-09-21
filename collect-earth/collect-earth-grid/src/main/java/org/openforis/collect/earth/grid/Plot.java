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

	public int getGridFlags() {
		return gridFlags;
	}

	public void setGridFlags(int gridFlags) {
		this.gridFlags = gridFlags;
	}

	public static long getSerialversionuid() {
		return serialVersionUID;
	}

	
	/*
	 * The identifier only. The three @Id fields with no @IdClass make the entity its own composite identifier, so Hibernate
	 * compares plots with these two methods when it looks one up. They also took the coordinates and the flags into account,
	 * which are not part of the key : two instances of the same row that differed in a coordinate were treated as different
	 * plots, and changing a coordinate on a loaded plot changed its hash while it sat in the session.
	 */
	@Override
	public int hashCode() {
		final int prime = 31;
		int result = 1;
		result = prime * result + col;
		result = prime * result + gridDistance;
		result = prime * result + row;
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
		return row == other.row;
	}

	
}
