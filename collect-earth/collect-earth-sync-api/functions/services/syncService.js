const admin = require("firebase-admin");

class SyncService {
	constructor(db) {
		this.db = db;
	}

	async registerProject(payload) {
		this.requireFields(payload, ["projectId", "surveyFingerprint"]);

		const now = admin.firestore.FieldValue.serverTimestamp();
		const ref = this.db.collection("projects").doc(payload.projectId);
		const existing = await ref.get();

		if (existing.exists && existing.data().surveyFingerprint !== payload.surveyFingerprint) {
			const error = new Error("Project exists with a different survey fingerprint");
			error.status = 409;
			throw error;
		}

		await ref.set({
			projectId: payload.projectId,
			name: payload.name || payload.projectId,
			surveyFingerprint: payload.surveyFingerprint,
			updatedAt: now,
			createdAt: existing.exists ? existing.data().createdAt : now
		}, {merge: true});

		return {
			projectId: payload.projectId,
			surveyFingerprint: payload.surveyFingerprint
		};
	}

	async acceptEvents(payload) {
		this.requireFields(payload, ["projectId", "clientId", "events"]);

		await this.validateProject(payload.projectId, payload.surveyFingerprint);
		await this.registerClient(payload.projectId, payload.clientId, payload);

		const accepted = [];
		const conflicts = [];

		for (const event of payload.events) {
			this.requireFields(event, ["eventId", "plotKey", "operation", "payload"]);
			const result = await this.acceptEvent(payload.projectId, payload.clientId, event);
			if (result.status === "accepted") {
				accepted.push(result);
			} else {
				conflicts.push(result);
			}
		}

		return {accepted, conflicts};
	}

	async acceptEvent(projectId, clientId, event) {
		const eventRef = this.db.collection("syncEvents").doc(event.eventId);
		const plotRef = this.db.collection("plotStates").doc(this.plotDocId(projectId, event.plotKey));
		const now = admin.firestore.FieldValue.serverTimestamp();

		return this.db.runTransaction(async (tx) => {
			const existingEvent = await tx.get(eventRef);
			if (existingEvent.exists) {
				return {eventId: event.eventId, plotKey: event.plotKey, status: "accepted", duplicate: true};
			}

			const plotSnap = await tx.get(plotRef);
			const currentRevision = plotSnap.exists ? plotSnap.data().serverRevision || 0 : 0;
			const baseRevision = event.baseRevision || 0;

			if (baseRevision !== currentRevision) {
				const conflictRef = this.db.collection("syncConflicts").doc(event.eventId);
				tx.set(conflictRef, {
					projectId,
					clientId,
					event,
					currentRevision,
					status: "open",
					createdAt: now
				});
				return {
					eventId: event.eventId,
					plotKey: event.plotKey,
					status: "conflict",
					currentRevision
				};
			}

			const nextRevision = currentRevision + 1;
			tx.set(eventRef, {
				...event,
				projectId,
				clientId,
				serverRevision: nextRevision,
				acceptedAt: now
			});
			tx.set(plotRef, {
				projectId,
				plotKey: event.plotKey,
				serverRevision: nextRevision,
				status: event.payload.status || "updated",
				completedBy: event.payload.completedBy || null,
				completedAt: event.payload.completedAt || (event.payload.status === "completed" ? now : null),
				updatedByClientId: clientId,
				updatedAt: now
			}, {merge: true});

			return {
				eventId: event.eventId,
				plotKey: event.plotKey,
				status: "accepted",
				serverRevision: nextRevision
			};
		});
	}

	async getChanges(query) {
		this.requireFields(query, ["projectId"]);
		await this.validateProject(query.projectId, query.surveyFingerprint);

		const afterRevision = Number(query.afterRevision || 0);
		const snapshot = await this.db.collection("syncEvents")
			.where("projectId", "==", query.projectId)
			.where("serverRevision", ">", afterRevision)
			.orderBy("serverRevision", "asc")
			.limit(Number(query.limit || 200))
			.get();

		const events = snapshot.docs.map((doc) => doc.data());
		const nextRevision = events.length > 0 ? events[events.length - 1].serverRevision : afterRevision;
		return {events, nextRevision};
	}

	async getPlotStatus(query) {
		this.requireFields(query, ["projectId"]);
		await this.validateProject(query.projectId, query.surveyFingerprint);

		const snapshot = await this.db.collection("plotStates")
			.where("projectId", "==", query.projectId)
			.limit(Number(query.limit || 500))
			.get();

		return {
			plots: snapshot.docs.map((doc) => doc.data())
		};
	}

	async claimPlot(plotKey, payload) {
		this.requireFields(payload, ["projectId", "clientId"]);
		await this.validateProject(payload.projectId, payload.surveyFingerprint);
		await this.registerClient(payload.projectId, payload.clientId, payload);

		const nowMillis = Date.now();
		const leaseMillis = Number(payload.leaseMillis || 120000);
		const expiresAt = admin.firestore.Timestamp.fromMillis(nowMillis + leaseMillis);
		const ref = this.db.collection("plotLeases").doc(this.plotDocId(payload.projectId, plotKey));

		await ref.set({
			projectId: payload.projectId,
			plotKey,
			clientId: payload.clientId,
			userName: payload.userName || null,
			expiresAt,
			updatedAt: admin.firestore.FieldValue.serverTimestamp()
		}, {merge: true});

		return {plotKey, clientId: payload.clientId, expiresAt: expiresAt.toDate().toISOString()};
	}

	async validateProject(projectId, surveyFingerprint) {
		const project = await this.db.collection("projects").doc(projectId).get();
		if (!project.exists) {
			const error = new Error("Project has not been registered");
			error.status = 404;
			throw error;
		}
		if (surveyFingerprint && project.data().surveyFingerprint !== surveyFingerprint) {
			const error = new Error("Survey fingerprint does not match the registered project");
			error.status = 409;
			throw error;
		}
	}

	async registerClient(projectId, clientId, payload) {
		const now = admin.firestore.FieldValue.serverTimestamp();
		await this.db.collection("syncClients").doc(`${projectId}__${clientId}`.replace(/[\/#?\[\]]/g, "_")).set({
			projectId,
			clientId,
			userName: payload.userName || null,
			lastSeenAt: now
		}, {merge: true});
	}

	plotDocId(projectId, plotKey) {
		return `${projectId}__${plotKey}`.replace(/[\/#?\[\]]/g, "_");
	}

	requireFields(payload, fields) {
		if (!payload) {
			const error = new Error("Request body is required");
			error.status = 400;
			throw error;
		}
		const missing = fields.filter((field) => payload[field] === undefined || payload[field] === null || payload[field] === "");
		if (missing.length > 0) {
			const error = new Error(`Missing required field(s): ${missing.join(", ")}`);
			error.status = 400;
			throw error;
		}
	}
}

module.exports = {SyncService};
