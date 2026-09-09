// Electron main process for Primordial Life
const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

app.commandLine.appendSwitch("enable-precise-memory-info");

const logDir = app.getPath("userData");
const logFile = path.join(logDir, "primlife.log");
function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}\n`;
  try { fs.appendFileSync(logFile, msg); } catch (e) { /* ignore */ }
}
log(`--- app start, version ${app.getVersion()} ---`);
log(`log file: ${logFile}`);

app.whenReady().then(createWindow);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Primordial Life",
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      // local offline app; renderer uses require() for the sim modules
      contextIsolation: false,
      nodeIntegration: true,
    },
  });

  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, "..", "src", "index.html"));

  // capture renderer console output (including our try/catch error logs) into the logfile
  win.webContents.on("console-message", (event, level, message, line, sourceId) => {
    log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on("render-process-gone", (event, details) => {
    log(`RENDER PROCESS GONE: ${JSON.stringify(details)}`);
  });
  win.webContents.on("unresponsive", () => log("WINDOW UNRESPONSIVE"));
  win.webContents.on("responsive", () => log("window responsive again"));

  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") {
      win.setFullScreen(!win.isFullScreen());
    } else if (input.key === "Escape") {
      if (win.isFullScreen()) win.setFullScreen(false);
      else app.quit();
    }
  });
}

process.on("uncaughtException", (err) => log(`MAIN UNCAUGHT: ${err.stack || err}`));

app.on("window-all-closed", () => app.quit());
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
