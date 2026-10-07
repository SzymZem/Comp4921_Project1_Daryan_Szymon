const crypto = require('crypto');
const database = require('../databaseConnection');

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 6;
const MAX_GENERATE_ATTEMPTS = 5;
const CUSTOM_CODE_REGEX = /^[A-Za-z0-9_-]{3,32}$/;
const MAX_TEXT_LENGTH = 10000;
const CONTENT_TYPES = ['link', 'text', 'image'];

// Each content type has its own table. Queries alias the columns back to
// content_id / data so callers and views don't care which table a row came from.
// These names come from this fixed map only, never from user input.
const CONTENT_TABLES = {
	link: { table: 'link', id: 'link_id', value: 'link_to' },
	text: { table: 'text', id: 'text_id', value: 'text_value' },
	image: { table: 'image', id: 'image_id', value: 'image_public_id' }
};

// Short codes live at the site root (e.g. /abc123), so they can't collide with
// our own single-segment routes. Express routing is case-insensitive, so compare lowercase.
const RESERVED_CODES = new Set([
	'about', 'contact', 'submitemail', 'createtables', 'signup', 'members', 'login',
	'submituser', 'loggingin', 'logout', 'loggedin', 'api', 'creategroup', 'group',
	'message', 'links', 'content', 'emojis'
]);

function isReservedCode(code) {
	return RESERVED_CODES.has(code.toLowerCase());
}

function isValidCustomCode(code) {
	return CUSTOM_CODE_REGEX.test(code) && !isReservedCode(code);
}

function isValidText(text) {
	return typeof text === 'string' && text.trim().length > 0 && text.length <= MAX_TEXT_LENGTH;
}

function generateCode() {
	let code;
	do {
		code = '';
		for (let i = 0; i < CODE_LENGTH; i++) {
			code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
		}
	} while (isReservedCode(code));
	return code;
}

// Returns a normalized http(s) URL, or null if the input isn't one.
// Rejects other schemes (javascript:, data:, etc.) so a short link can't be used for XSS.
function normalizeUrl(input) {
	let url = (input || '').trim();
	if (url.length === 0) {
		return null;
	}
	if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
		url = 'https://' + url;
	}

	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return null;
		}
		return parsed.href;
	}
	catch (err) {
		return null;
	}
}

// Duplicate codes within one table are rejected by its PRIMARY KEY, so two requests
// racing for the same code can't both succeed - the loser gets ER_DUP_ENTRY.
// Codes also have to be unique across all three tables, which no single key covers,
// so after inserting we check the other tables and back out if the code is there.
// If two inserts into different tables race, each sees the other and both back out,
// which is safe: neither code ends up shared.
async function insertContent(contentId, userId, contentType, data) {
	const t = CONTENT_TABLES[contentType];
	let insertSQL = `
		INSERT INTO \`${t.table}\`
		(${t.id}, user_id, ${t.value})
		VALUES
		(?, ?, ?);
	`;

	await database.query(insertSQL, [contentId, userId, data]);

	const others = CONTENT_TYPES.filter(type => type !== contentType).map(type => CONTENT_TABLES[type]);
	let takenSQL = others
		.map(o => `SELECT 1 FROM \`${o.table}\` WHERE ${o.id} = ?`)
		.join(' UNION ALL ');

	const [rows] = await database.query(takenSQL, others.map(() => contentId));
	if (rows.length > 0) {
		await database.query(`DELETE FROM \`${t.table}\` WHERE ${t.id} = ?;`, [contentId]);
		const err = new Error("Short code already used by another content type");
		err.code = 'ER_DUP_ENTRY';
		throw err;
	}
}

async function createContent(userId, contentType, data, customCode) {
	if (customCode) {
		try {
			await insertContent(customCode, userId, contentType, data);
			return { success: true, contentId: customCode };
		}
		catch (err) {
			if (err.code === 'ER_DUP_ENTRY') {
				return { success: false, error: "That short URL is already taken." };
			}
			console.log("Error creating content");
			console.log(err);
			return { success: false, error: "Failed to create content." };
		}
	}

	for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
		const code = generateCode();
		try {
			await insertContent(code, userId, contentType, data);
			return { success: true, contentId: code };
		}
		catch (err) {
			if (err.code === 'ER_DUP_ENTRY') {
				continue;
			}
			console.log("Error creating content");
			console.log(err);
			return { success: false, error: "Failed to create content." };
		}
	}

	return { success: false, error: "Failed to generate a unique short URL. Please try again." };
}

async function getContent(contentId) {
	let getContentSQL = CONTENT_TYPES
		.map(type => {
			const t = CONTENT_TABLES[type];
			return `
				SELECT ${t.id} AS content_id, user_id, '${type}' AS content_type, ${t.value} AS data, active
				FROM \`${t.table}\`
				WHERE ${t.id} = ?`;
		})
		.join(' UNION ALL ') + ';';

	try {
		const [rows] = await database.query(getContentSQL, CONTENT_TYPES.map(() => contentId));
		return rows[0] || null;
	}
	catch (err) {
		console.log("Error getting content");
		console.log(err);
		return null;
	}
}

async function getUserContent(userId, contentType) {
	const t = CONTENT_TABLES[contentType];
	let getUserContentSQL = `
		SELECT ${t.id} AS content_id, '${contentType}' AS content_type, ${t.value} AS data,
			active, hits, created_datetime, last_hit_datetime
		FROM \`${t.table}\`
		WHERE user_id = ?
		ORDER BY created_datetime DESC;
	`;

	try {
		const [rows] = await database.query(getUserContentSQL, [userId]);
		return rows;
	}
	catch (err) {
		console.log("Error getting user content");
		console.log(err);
		return [];
	}
}

async function recordHit(contentType, contentId) {
	const t = CONTENT_TABLES[contentType];
	let recordHitSQL = `
		UPDATE \`${t.table}\`
		SET hits = hits + 1, last_hit_datetime = NOW()
		WHERE ${t.id} = ?;
	`;

	try {
		await database.query(recordHitSQL, [contentId]);
	}
	catch (err) {
		console.log("Error recording hit");
		console.log(err);
	}
}

// The user_id check makes these no-ops on content the user doesn't own.
// Returns true only if a row owned by the user was changed.
async function toggleActive(contentType, contentId, userId) {
	const t = CONTENT_TABLES[contentType];
	let toggleSQL = `
		UPDATE \`${t.table}\`
		SET active = NOT active
		WHERE ${t.id} = ? AND user_id = ?;
	`;

	try {
		const [result] = await database.query(toggleSQL, [contentId, userId]);
		return result.affectedRows > 0;
	}
	catch (err) {
		console.log("Error toggling content");
		console.log(err);
		return false;
	}
}

async function deleteContent(contentType, contentId, userId) {
	const t = CONTENT_TABLES[contentType];
	let deleteSQL = `
		DELETE FROM \`${t.table}\`
		WHERE ${t.id} = ? AND user_id = ?;
	`;

	try {
		const [result] = await database.query(deleteSQL, [contentId, userId]);
		return result.affectedRows > 0;
	}
	catch (err) {
		console.log("Error deleting content");
		console.log(err);
		return false;
	}
}

module.exports = {
	CONTENT_TYPES,
	MAX_TEXT_LENGTH,
	isValidCustomCode,
	isValidText,
	normalizeUrl,
	createContent,
	getContent,
	getUserContent,
	recordHit,
	toggleActive,
	deleteContent
};
