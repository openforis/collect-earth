-- Table: public.plot

-- DROP TABLE public.plot;

CREATE TABLE IF NOT EXISTS public.plot
(
  row smallint NOT NULL,
  griddistance smallint NOT NULL,
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

-- DROP INDEX public."Gridflag";

CREATE INDEX IF NOT EXISTS "Gridflag"
  ON public.plot
  USING btree
  (gridflags);
