import IndexSeriesCard from "./IndexSeriesCard";
import type { CardProps } from "../../lib/folds";

export default function Sentinel2NdviCard(props: CardProps) {
  return <IndexSeriesCard type="sentinel2-series" {...props} />;
}
