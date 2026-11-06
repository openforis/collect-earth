import type { SvgIconComponent } from "@mui/icons-material";
import AddLocationAltOutlinedIcon from "@mui/icons-material/AddLocationAltOutlined";
import PivotTableChartOutlinedIcon from "@mui/icons-material/PivotTableChartOutlined";
import BugReportOutlinedIcon from "@mui/icons-material/BugReportOutlined";
import CallSplitOutlinedIcon from "@mui/icons-material/CallSplitOutlined";
import CloudSyncOutlinedIcon from "@mui/icons-material/CloudSyncOutlined";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import DeleteSweepOutlinedIcon from "@mui/icons-material/DeleteSweepOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import FileOpenOutlinedIcon from "@mui/icons-material/FileOpenOutlined";
import FileUploadOutlinedIcon from "@mui/icons-material/FileUploadOutlined";
import FolderOpenOutlinedIcon from "@mui/icons-material/FolderOpenOutlined";
import ForestOutlinedIcon from "@mui/icons-material/ForestOutlined";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import GroupAddOutlinedIcon from "@mui/icons-material/GroupAddOutlined";
import HelpOutlineOutlinedIcon from "@mui/icons-material/HelpOutlineOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ManageSearchOutlinedIcon from "@mui/icons-material/ManageSearchOutlined";
import MapOutlinedIcon from "@mui/icons-material/MapOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import PowerSettingsNewOutlinedIcon from "@mui/icons-material/PowerSettingsNewOutlined";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import SystemUpdateAltOutlinedIcon from "@mui/icons-material/SystemUpdateAltOutlined";
import TranslateOutlinedIcon from "@mui/icons-material/TranslateOutlined";

/**
 * The icon of each entry of the app bar's menus (menus.ts), by its id: in the navigation drawer of the compact bar and
 * in the menus of the wide one. Kept out of menus.ts, which stays plain data.
 */
export const MENU_ICONS: Record<string, SvgIconComponent> = {
  importCep: FileOpenOutlinedIcon,
  joinCloud: GroupAddOutlinedIcon,
  cloudStatus: CloudSyncOutlinedIcon,
  language: TranslateOutlinedIcon,
  quit: PowerSettingsNewOutlinedIcon,
  export: FileDownloadOutlinedIcon,
  import: FileUploadOutlinedIcon,
  analyse: PivotTableChartOutlinedIcon,
  lulucf: ForestOutlinedIcon,
  loadKml: AddLocationAltOutlinedIcon,
  dataFolder: FolderOpenOutlinedIcon,
  myDashboard: DashboardOutlinedIcon,
  openPlotsMap: MapOutlinedIcon,
  missingPlots: ManageSearchOutlinedIcon,
  divideCsv: CallSplitOutlinedIcon,
  deletePlots: DeleteSweepOutlinedIcon,
  properties: SettingsOutlinedIcon,
  surveyGuide: MenuBookOutlinedIcon,
  manual: HelpOutlineOutlinedIcon,
  support: ForumOutlinedIcon,
  log: ReceiptLongOutlinedIcon,
  showExceptions: BugReportOutlinedIcon,
  updates: SystemUpdateAltOutlinedIcon,
  disclaimer: GavelOutlinedIcon,
  about: InfoOutlinedIcon,
};

/** The icon of an entry, small, as menus show them; none for an entry without one. */
export function MenuEntryIcon({ id }: { id: string }) {
  const Icon = MENU_ICONS[id];
  return Icon ? <Icon fontSize="small" /> : null;
}
