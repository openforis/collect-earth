-- Table: plot

-- DROP TABLE plot;

CREATE TABLE IF NOT EXISTS plot
(
  row integer NOT NULL,
  griddistance integer NOT NULL,
  col integer NOT NULL,
  gridflags integer,
  xcoordinate integer,
  ycoordinate integer,
  CONSTRAINT plot_pkey PRIMARY KEY (row, griddistance, col)
);
