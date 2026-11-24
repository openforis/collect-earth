import IndexSeriesCard from "./IndexSeriesCard";
import type { CardProps } from "../../lib/folds";

export default function LandsatNdviCard(props: CardProps) {
  return <IndexSeriesCard type="landsat-series" {...props} />;
}
