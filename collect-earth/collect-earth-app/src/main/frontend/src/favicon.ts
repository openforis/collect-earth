import icon from "@shared/collect-earth-icon.png";

// The browser tab's icon, from the folder Collect Earth shares with the dashboard (the pages' HTML cannot name it)
const link = document.createElement("link");
link.rel = "icon";
link.type = "image/png";
link.href = icon;
document.head.appendChild(link);
