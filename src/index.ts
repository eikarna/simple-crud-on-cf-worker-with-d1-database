import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import apiFile from '../data/apikey.json';
import os from 'os';
import speed from 'performance-now';
import { D1Database, Fetcher } from '@cloudflare/workers-types/experimental';

// This ensures c.env.DB is correctly typed
type Bindings = {
	DB: D1Database;
  ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', async(c) => {
  await c.env.ASSETS.fetch('/assets/index.html');
});

app.get('/favicon.ico', async (c) => {
  await c.env.ASSETS.fetch("/assets/favicon.ico");
});

// Configure API key authentication
app.use('/api/db', bearerAuth({ token: apiFile.apikey_list.map((apikey) => apikey.key) }));

// Define API endpoint to retrieve data from D1 database
app.get('/api/db', async (c) => {
	const apiKey = c.req.header('Authorization')?.split(' ')[1];
	const table = apiFile.apikey_list.find((apikey) => apikey.key === apiKey)?.table;

	// Check if the table exists
	var tableExists;
	try {
		tableExists = await c.env.DB.prepare(`SELECT * FROM '${table}'`).all();
	} catch (e: any) {
		console.warn(e.message);
		// Create the table if it doesn't exist
		await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY, data TEXT)`).all();
	}

	const query = `SELECT * FROM ${table}`;
	const results = await c.env.DB.prepare(query).all();
	return c.json(results);
});

// SET /api/data
app.post('/api/db', async (c) => {
	const apiKey = c.req.header('Authorization')?.split(' ')[1];
	const table = apiFile.apikey_list.find((apikey) => apikey.key === apiKey)?.table;
	const data = c.req.json();

	// Upsert data into the table
	try {
		await c.env.DB.prepare(`INSERT INTO ${table} (data) VALUES (?) ON CONFLICT (id) DO UPDATE SET data = ?`).bind([data, data]).run();
	} catch (e: any) {
		return c.json({ success: false, message: e.message });
	}
	return c.json({ success: true, message: 'Data upserted successfully' });
});

// DELETE /api/data
app.delete('/api/db', async (c) => {
	const apiKey = c.req.header('Authorization')?.split(' ')[1];
	const table = apiFile.apikey_list.find((apikey) => apikey.key === apiKey)?.table;
	const id = c.req.param('id');

	// Delete data from the table
	try {
		await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind([id]).run();
	} catch (e: any) {
		return c.json({ success: false, message: e.message });
	}
	return c.json({ success: true, message: 'Data deleted successfully' });
});

// STATUS /api/status
app.get('/api/status', async (c) => {
	const bytesToSize = (bytes) => {
		const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
		if (bytes == 0) return '0 Byte';
		const i = Math.floor(Math.log(bytes) / Math.log(1000));
		return Math.round(bytes / Math.pow(1000, i)) + ' ' + sizes[i];
	};

	function format(seconds) {
		function pad(s) {
			return (s < 10 ? '0' : '') + s;
		}
		var hours = Math.floor(seconds / (60 * 60));
		var minutes = Math.floor((seconds % (60 * 60)) / 60);
		var seconds2 = Math.floor(seconds % 60);

		return pad(hours) + ':' + pad(minutes) + ':' + pad(seconds2);
	}

	let listcpus = os.cpus();
	let totalmem = bytesToSize(os.totalmem());
	let freemem = bytesToSize(os.freemem());
	let uptime = format(process.uptime());
	let hostname = os.hostname();
	let platform = os.platform();
	let speeds = speed();
	return c.json({
		success: true,
    hostname: hostname,
    system_speed: (speeds / 60).toFixed(2) + " ms",
		free_memory: freemem,
		total_memory: totalmem,
		runtime: uptime,
		platform: platform,
		cpus: [...listcpus],
	});
});

export default app;
