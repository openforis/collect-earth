import icon from "@shared/collect-earth-emblem.png";

// The icon of the window and its taskbar button: the Collect Earth emblem, 128 px so Windows does not enlarge a small
// one. From the folder Collect Earth shares with the dashboard (the pages' HTML cannot name it)
const link = document.createElement("link");
link.rel = "icon";
link.type = "image/png";
link.href = icon;
document.head.appendChild(link);
