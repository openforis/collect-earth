const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const {onRequest} = require("firebase-functions/v2/https");
const {SyncService} = require("./services/syncService");

admin.initializeApp();

const app = express();
const syncService = new SyncService(admin.firestore());

app.use(cors({origin: true}));
app.use(express.json({limit: "2mb"}));

app.get("/health", (req, res) => {
	res.json({ok: true, service: "collect-earth-sync-api"});
});

app.post("/api/v1/projects/register", async (req, res, next) => {
	try {
		const project = await syncService.registerProject(req.body);
		res.status(201).json(project);
	} catch (error) {
		next(error);
	}
});

app.post("/api/v1/sync/events", async (req, res, next) => {
	try {
		const result = await syncService.acceptEvents(req.body);
		res.json(result);
	} catch (error) {
		next(error);
	}
});

app.get("/api/v1/sync/changes", async (req, res, next) => {
	try {
		const result = await syncService.getChanges(req.query);
		res.json(result);
	} catch (error) {
		next(error);
	}
});

app.get("/api/v1/plots/status", async (req, res, next) => {
	try {
		const result = await syncService.getPlotStatus(req.query);
		res.json(result);
	} catch (error) {
		next(error);
	}
});

app.post("/api/v1/plots/:plotKey/claim", async (req, res, next) => {
	try {
		const result = await syncService.claimPlot(req.params.plotKey, req.body);
		res.json(result);
	} catch (error) {
		next(error);
	}
});

app.use((error, req, res, next) => {
	const status = error.status || 500;
	res.status(status).json({
		error: error.message || "Unexpected sync API error"
	});
});

exports.syncApi = onRequest(app);
