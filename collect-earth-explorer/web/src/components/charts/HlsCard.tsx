import IndexSeriesCard from "./IndexSeriesCard";
import type { CardProps } from "../../lib/folds";

export default function HlsCard(props: CardProps) {
  return <IndexSeriesCard type="hls-series" {...props} />;
}
