-- Table: public.plot

-- DROP TABLE public.plot;

CREATE TABLE IF NOT EXISTS public.plot
(
  row integer NOT NULL,
  griddistance integer NOT NULL,
  col integer NOT NULL,
  gridflags integer,
  xcoordinate integer,
  ycoordinate integer,
  CONSTRAINT plot_pkey PRIMARY KEY (row, griddistance, col)
)
WITH (
  OIDS=FALSE
);
ALTER TABLE public.plot
  OWNER TO collectearth;

-- Index: public."Gridflag"

-- The queries select a bounding box of a given grid distance, which the index on gridflags alone could not help with.
-- An existing database still carries "Gridflag"; drop it by hand if the inserts are slower than they need to be.

CREATE INDEX IF NOT EXISTS plot_distance_coordinates
  ON public.plot
  USING btree
  (griddistance, xcoordinate, ycoordinate);
